'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, FileCheck2, Loader2, RotateCcw, X } from 'lucide-react';
import { buildXlsx } from '@/lib/xlsx/writer';
import {
  BODEGA_HEADER, CARVAJAL_BODEGAS, buildCarvajalSheet, carvajalFilename,
  lineTotal, weekOfMonth, type CarvajalBodega, type ExportLine,
} from '@/lib/compras/carvajal';
import { fmt } from '../reabastecimiento/engine';

/**
 * "Exportar plan de compra" — W1 format (a): the sheet Wilmer sends Carvajal.
 *
 * Wilmer, 2026-08-20: *"yo tengo la visual, pero yo necesito eso llevarlo a algo
 * que se comunique al proveedor"* — and *"yo no digito, me prefiero copiar y
 * pegar porque se me equivocó un código"*.
 *
 * DRAFT, NOT AN ANSWER (decision with Jorge, 2026-08-21). The app proposes a
 * number and he edits any cell before downloading; the file carries exactly
 * what is on screen. That is deliberate: the weekly split is his judgement, not
 * ours — he also sequences against Carvajal's own excess (*"ellos tienen
 * demasiado de eso… me manda esto primero y lo que me urge no me lo manda"*),
 * which no formula here can know.
 *
 * RESUMABLE (Jorge, 2026-08-21): every edit is autosaved to `export_plan_draft`
 * keyed by proveedor × semana × mes, so closing the modal — or the laptop — no
 * longer throws the work away. Reopening OFFERS the saved draft rather than
 * silently restoring or silently discarding it: the saved lines and the lines
 * currently on screen can legitimately differ, and picking one for him without
 * saying so is how people lose an afternoon of typing.
 *
 * Every DOWNLOAD is recorded to `export_plan_emitido` (immutable, one row per
 * download, with a sha256 of the actual bytes) — the draft says what he was
 * thinking, that says what went out. Recording is best-effort and reported: if
 * it fails the file still downloads, because blocking the thing he needs in
 * order to keep our own audit trail would be the wrong trade.
 *
 * ⚠️ The saved draft is INERT. Nothing reads it back into tránsito, Sugerido or
 * fill-rate — that stays a separate, deliberate decision.
 *
 * ⚠️ THE PRE-FILL IS AN ASSUMPTION, not a measured rule: Sugerido ÷ 4, because
 * the Sugerido covers a month and this sheet covers a week. It is labelled as
 * such on screen and the underlying Sugerido is one hover away, so he is never
 * editing a number whose origin is hidden. Open question for him: what the
 * weekly figure should actually be derived from.
 */

interface ApiLine {
  productId: number;
  cod: string; desc: string; prov: string;
  porBodega: Record<string, { sug: number; doh: number; exist: number; trans: number } | null>;
}

type Cobertura = Record<string, number>;

interface SavedLinea {
  product_id: number; cod: string; desc: string; orden: number;
  cantidades: Record<string, number | null>;
}

interface Draft extends ExportLine {
  productId: number;
  /** The monthly Sugerido per bodega, kept for the hover so the origin stays visible. */
  sug: Record<string, number | null>;
}

/** Days the sheet covers: it is a weekly ask. */
const DIAS_SEMANA = 7;

/** Draft key: the month the sheet is for, as the first of that month. */
function mesKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const SAVE_DEBOUNCE_MS = 800;

/**
 * SHA-256 of the downloaded bytes, so the record can say "this is the file that
 * went out" rather than "a file like this one". Returns null where WebCrypto is
 * unavailable (non-secure context) — an honest null beats a fabricated hash.
 */
async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * Weekly proposal from a Sugerido that covers `coberturaDias` days.
 *
 * Derived from the bodega's OWN horizon rather than a fixed divisor: since
 * 2026-08-21 Zacapa and Petén cover 15 days, not 30 (Wilmer), so a flat ÷4
 * would propose roughly half of what a week there actually needs.
 */
function proposal(sug: number | null | undefined, coberturaDias: number): number | null {
  if (typeof sug !== 'number' || !Number.isFinite(sug) || sug <= 0) return null;
  if (!Number.isFinite(coberturaDias) || coberturaDias <= 0) return null;
  return Math.round(sug * (DIAS_SEMANA / coberturaDias));
}

export function ExportCarvajal({ productIds, bodega }: { productIds: number[]; bodega: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Draft[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /** A saved draft found on open, offered but not yet applied. */
  const [pending, setPending] = useState<{ lineas: SavedLinea[]; autor: string; updated_at: string } | null>(null);
  const [cobertura, setCobertura] = useState<Cobertura>({});
  const [emitState, setEmitState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastEmision, setLastEmision] = useState<{ archivo: string; autor: string; created_at: string; total_lineas: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const [proveedor, setProveedor] = useState('Carvajal');
  // He sends the sheet for the week AHEAD — default to it, but it stays editable
  // because how far ahead depends on when he gets to it.
  const [semana, setSemana] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return weekOfMonth(d);
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/compras/reabastecimiento/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'No se pudo preparar la exportación');
      const cob: Cobertura = json.cobertura ?? {};
      setCobertura(cob);
      const drafted: Draft[] = (json.lines as ApiLine[]).map((l) => {
        const cantidades: Record<string, number | null> = {};
        const sug: Record<string, number | null> = {};
        for (const b of CARVAJAL_BODEGAS) {
          sug[b] = l.porBodega[b]?.sug ?? null;
          cantidades[b] = proposal(l.porBodega[b]?.sug, cob[b] ?? 30);
        }
        return { productId: l.productId, cod: l.cod, desc: l.desc, cantidades, sug };
      });
      setLines(drafted);

      // A saved draft is OFFERED, never auto-applied: it may hold a different
      // set of lines than the view he just came from.
      const q = new URLSearchParams({ proveedor, semana: String(semana), mes: mesKey() });
      const dRes = await fetch(`/api/compras/reabastecimiento/export/draft?${q}`);
      if (dRes.ok) {
        const dJson = await dRes.json();
        setPending(dJson?.draft ?? null);
      }

      const eRes = await fetch(`/api/compras/reabastecimiento/export/emitido?${q}`);
      if (eRes.ok) {
        const eJson = await eRes.json();
        setLastEmision(eJson?.emisiones?.[0] ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [productIds, proveedor, semana]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const save = useCallback(async (rows: Draft[]) => {
    setSaveState('saving');
    try {
      const res = await fetch('/api/compras/reabastecimiento/export/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedor,
          semana,
          mes: mesKey(),
          lineas: rows.map((l, i) => ({
            product_id: l.productId, cod: l.cod, desc: l.desc, orden: i,
            cantidades: l.cantidades,
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'fallo al guardar');
      setSaveState('saved');
    } catch {
      // Surfaced, never swallowed — if the draft is not saved he must know now,
      // not when he reopens and finds nothing.
      setSaveState('error');
    }
  }, [proveedor, semana]);

  // Debounced autosave. Only fires once he has actually edited something, so
  // merely opening the modal never overwrites a saved draft with a proposal.
  useEffect(() => {
    if (!open || !dirty.current) return undefined;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void save(lines); }, SAVE_DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [lines, open, save]);

  const setQty = (productId: number, b: CarvajalBodega, raw: string) => {
    dirty.current = true;
    const trimmed = raw.trim();
    const parsed = trimmed === '' ? null : Number(trimmed.replace(/,/g, ''));
    setLines((prev) => prev.map((l) => (
      l.productId === productId
        ? { ...l, cantidades: { ...l.cantidades, [b]: parsed === null || Number.isNaN(parsed) ? null : parsed } }
        : l
    )));
  };

  const applySaved = () => {
    if (!pending) return;
    const byId = new Map(pending.lineas.map((l) => [l.product_id, l]));
    // Saved quantities win for lines the draft knows; lines it does not know
    // keep the proposal, and saved lines missing from the current view are
    // re-added so his typing is never silently dropped.
    const merged: Draft[] = lines.map((l) => {
      const saved = byId.get(l.productId);
      return saved ? { ...l, cantidades: { ...l.cantidades, ...saved.cantidades } } : l;
    });
    const known = new Set(lines.map((l) => l.productId));
    for (const sl of pending.lineas) {
      if (known.has(sl.product_id)) continue;
      merged.push({
        productId: sl.product_id, cod: sl.cod, desc: sl.desc,
        cantidades: sl.cantidades, sug: {},
      });
    }
    merged.sort((a, b) => (byId.get(a.productId)?.orden ?? 1e9) - (byId.get(b.productId)?.orden ?? 1e9));
    setLines(merged);
    setPending(null);
  };

  const download = async () => {
    // Only rows that actually ask for something reach the supplier — an all-blank
    // line is noise in a file someone has to read.
    const withQty = lines.filter((l) => lineTotal(l) !== null && (lineTotal(l) as number) > 0);
    const bytes = buildXlsx(buildCarvajalSheet(withQty));
    const archivo = carvajalFilename(semana, new Date(), proveedor);

    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = archivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Record what went out. The file is already in his hands at this point —
    // a failure here is reported, never allowed to look like a failed download.
    setEmitState('saving');
    try {
      const res = await fetch('/api/compras/reabastecimiento/export/emitido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedor, semana, mes: mesKey(), archivo,
          sha256: await sha256Hex(bytes),
          lineas: withQty.map((l, i) => ({
            product_id: l.productId, cod: l.cod, desc: l.desc, prioridad: i + 1,
            cantidades: l.cantidades,
            // What the app was proposing at this moment — the only chance to
            // capture it, since the Sugerido moves with every sync.
            sugerido: l.sug,
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'fallo al registrar');
      const json = await res.json();
      setEmitState('saved');
      setLastEmision({
        archivo, autor: json.autor, created_at: json.created_at,
        total_lineas: json.total_lineas,
      });
    } catch {
      setEmitState('error');
    }
  };

  const exportables = lines.filter((l) => {
    const t = lineTotal(l);
    return t !== null && t > 0;
  }).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={productIds.length === 0}
        className="inline-flex items-center gap-1.5 rounded-lg border border-teal-600 bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-200 disabled:text-gray-400"
        title="Descargar el plan en el formato que le mandás al proveedor"
      >
        <Download size={13} /> Exportar xlsx
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
             role="dialog" aria-modal="true" aria-label="Exportar plan de compra">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-gray-200 px-5 py-3.5">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Exportar plan de compra — formato proveedor</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  El archivo lleva <b>exactamente lo que ves acá</b>. La <b>Prioridad</b> es el orden de
                  esta lista (viene ordenada por días de inventario). Vista actual: <b>{bodega}</b>.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-3 border-b border-gray-100 bg-gray-50 px-5 py-3">
              <label className="text-xs text-gray-600">
                Proveedor
                <input value={proveedor} onChange={(e) => setProveedor(e.target.value)}
                       className="mt-1 block w-44 rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-gray-600">
                Semana
                <input type="number" min={1} max={5} value={semana}
                       onChange={(e) => setSemana(Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
                       className="mt-1 block w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
              </label>
              <div className="text-xs text-gray-500">
                Se descarga como<br />
                <code className="text-[11px] text-gray-700">{carvajalFilename(semana, new Date(), proveedor)}</code>
              </div>
            </div>

            {lastEmision ? (
              <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-5 py-2 text-xs text-gray-600">
                <FileCheck2 size={13} className="shrink-0 text-gray-400" />
                <span>
                  Última descarga para {proveedor} · semana {semana}: <b>{lastEmision.archivo}</b>{' '}
                  ({lastEmision.total_lineas} líneas) — {lastEmision.autor},{' '}
                  {new Date(lastEmision.created_at).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </div>
            ) : null}

            {pending ? (
              <div className="flex flex-wrap items-center gap-3 border-b border-teal-200 bg-teal-50 px-5 py-2.5 text-xs text-teal-900">
                <RotateCcw size={14} className="shrink-0" />
                <span>
                  Hay un <b>borrador guardado</b> para {proveedor} · semana {semana} — <b>{pending.lineas.length} líneas</b>,
                  última edición de <b>{pending.autor}</b> el{' '}
                  {new Date(pending.updated_at).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })}.
                </span>
                <span className="ml-auto flex gap-2">
                  <button type="button" onClick={applySaved}
                          className="rounded-lg bg-teal-600 px-2.5 py-1 font-semibold text-white hover:bg-teal-700">
                    Continuar ese borrador
                  </button>
                  <button type="button" onClick={() => setPending(null)}
                          className="rounded-lg border border-teal-300 px-2.5 py-1 font-medium text-teal-800 hover:bg-teal-100">
                    Empezar con la vista actual
                  </button>
                </span>
              </div>
            ) : null}

            <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">
              Las cantidades vienen <b>propuestas para una semana</b>, sacadas del Sugerido de cada bodega
              según los días que ese Sugerido cubre
              ({CARVAJAL_BODEGAS.map((b) => `${BODEGA_HEADER[b]} ${cobertura[b] ?? 30}d`).join(' · ')})
              — <b>es un supuesto nuestro, no una regla tuya</b>. Corregí lo que haga falta; pasá el mouse
              sobre una celda para ver el Sugerido del que salió.
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
                  <Loader2 size={16} className="animate-spin" /> Preparando…
                </div>
              ) : error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="px-2 py-2 text-left">Código</th>
                      <th className="px-2 py-2 text-left">Descripción</th>
                      <th className="px-2 py-2 text-right">{BODEGA_HEADER['San Jose VN']}</th>
                      <th className="px-2 py-2 text-right">Prioridad</th>
                      <th className="px-2 py-2 text-right">{BODEGA_HEADER['Petén']}</th>
                      <th className="px-2 py-2 text-right">{BODEGA_HEADER['Zacapa']}</th>
                      <th className="px-2 py-2 text-right">Total</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {lines.map((l, i) => {
                      const total = lineTotal(l);
                      const vacia = total === null || total <= 0;
                      return (
                        <tr key={l.productId} className={vacia ? 'text-gray-300' : 'hover:bg-teal-50/50'}>
                          <td className="border-b border-gray-100 px-2 py-1.5 text-left">{l.cod}</td>
                          <td className="max-w-[260px] truncate border-b border-gray-100 px-2 py-1.5 text-left">{l.desc}</td>
                          {(['San Jose VN'] as CarvajalBodega[]).map((b) => (
                            <QtyCell key={b} line={l} b={b} dias={cobertura[b] ?? 30} onChange={setQty} />
                          ))}
                          <td className="border-b border-gray-100 px-2 py-1.5 text-right text-gray-500">
                            {vacia ? '—' : i + 1}
                          </td>
                          {(['Petén', 'Zacapa'] as CarvajalBodega[]).map((b) => (
                            <QtyCell key={b} line={l} b={b} dias={cobertura[b] ?? 30} onChange={setQty} />
                          ))}
                          <td className="border-b border-gray-100 px-2 py-1.5 text-right font-semibold">
                            {total === null ? '' : fmt(total)}
                          </td>
                          <td className="border-b border-gray-100 px-1 py-1.5 text-right">
                            <button type="button" aria-label={`Quitar ${l.cod}`}
                                    onClick={() => {
                                      dirty.current = true;
                                      setLines((p) => p.filter((x) => x.productId !== l.productId));
                                    }}
                                    className="rounded p-0.5 text-gray-300 hover:bg-red-50 hover:text-red-600">
                              <X size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
              <div className="text-xs text-gray-500">
                <span className="mr-3 inline-flex items-center gap-1">
                  {saveState === 'saving' ? (
                    <><Loader2 size={12} className="animate-spin" /> Guardando…</>
                  ) : saveState === 'saved' ? (
                    <span className="inline-flex items-center gap-1 text-teal-700">
                      <Check size={12} /> Borrador guardado
                    </span>
                  ) : saveState === 'error' ? (
                    <span className="font-semibold text-red-600">⚠ No se pudo guardar el borrador</span>
                  ) : null}
                </span>
                <span className="mr-3 inline-flex items-center gap-1">
                  {emitState === 'saving' ? (
                    <><Loader2 size={12} className="animate-spin" /> Registrando la descarga…</>
                  ) : emitState === 'saved' ? (
                    <span className="inline-flex items-center gap-1 text-teal-700">
                      <FileCheck2 size={12} /> Descarga registrada
                    </span>
                  ) : emitState === 'error' ? (
                    <span className="font-semibold text-red-600">
                      ⚠ El archivo se descargó, pero NO quedó registrado
                    </span>
                  ) : null}
                </span>
                <b>{exportables}</b> de {lines.length} líneas se van a exportar
                {lines.length > exportables
                  ? <> · las {lines.length - exportables} en cero <b>no</b> se incluyen</> : null}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setOpen(false)}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="button" onClick={() => { void download(); }} disabled={loading || exportables === 0}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:bg-gray-200 disabled:text-gray-400">
                  <Download size={13} /> Descargar xlsx
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function QtyCell({ line, b, dias, onChange }: {
  line: Draft; b: CarvajalBodega; dias: number;
  onChange: (productId: number, b: CarvajalBodega, raw: string) => void;
}) {
  const v = line.cantidades[b];
  const sug = line.sug[b];
  return (
    <td className="border-b border-gray-100 px-2 py-1.5 text-right">
      <input
        value={v === null ? '' : String(v)}
        onChange={(e) => onChange(line.productId, b, e.target.value)}
        placeholder="—"
        aria-label={`${BODEGA_HEADER[b]} ${line.cod}`}
        title={typeof sug === 'number'
          ? `Sugerido ${BODEGA_HEADER[b]}: ${fmt(sug)} para ${dias} días · propuesta a 7 días = ${fmt(proposal(sug, dias) ?? 0)}`
          : `Sin Sugerido para ${BODEGA_HEADER[b]}`}
        className="w-20 rounded border border-gray-200 px-1.5 py-1 text-right text-[13px] focus:border-teal-500 focus:outline-none"
      />
    </td>
  );
}
