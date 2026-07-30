'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Boxes, CloudOff, PackageCheck, Pencil, RefreshCw, Search,
} from 'lucide-react';
import {
  type ProductRow, type Sev, sugerido, doh as dohOf, sev, fmt,
} from '../reabastecimiento/engine';

/**
 * Live client for /compras/reabastecimiento-vivo.
 *
 * Rows come computed from the API (engine applied server-side). Inline edits
 * (Tránsito, Pendiente) recompute locally with the SAME imported engine for
 * instant feedback, POST the entry (append-only), then silently refetch so the
 * server stays the source of truth.
 */

const SEV_PILL: Record<Sev, string> = {
  crit: 'bg-red-100 text-red-700',
  low: 'bg-amber-100 text-amber-700',
  ok: 'bg-emerald-100 text-emerald-700',
  exc: 'bg-blue-100 text-blue-700',
};

interface ApiRow {
  productId: number;
  cod: string; desc: string; prov: string;
  exist: number; existencias: number; reserved: number; patio: number;
  pending: number | null;
  trans: number; transOverridden: boolean;
  adic: number; p6: number; p3: number; h: number; win: 10 | 5;
  doh: number; sug: number;
  flags: { pendingUnknown: boolean; seasonalLowConfidence: boolean };
}
interface ApiMeta {
  count: number; asOf: string | null; month: string;
  lastSync: {
    id: string; status: string; started_at: string; finished_at: string | null;
    counts?: { data_horizon?: string | null };
  } | null;
}
interface ApiPayload {
  bodega: string; bodegas: string[]; rows: ApiRow[]; meta: ApiMeta;
}

function engineRowOf(r: ApiRow, exist: number, trans: number): ProductRow {
  return {
    cod: r.cod, desc: r.desc, prov: r.prov,
    exist, doh: 0, trans, sug: 0,
    p6: r.p6, p3: r.p3, h: r.h, adic: r.adic, win: r.win,
  };
}

export function VivoClient() {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [bodega, setBodega] = useState<string>('General');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [prov, setProv] = useState('');
  const [onlySug, setOnlySug] = useState(false);
  const [onlyCrit, setOnlyCrit] = useState(false);

  const load = useCallback(async (b: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/compras/reabastecimiento?bodega=${encodeURIComponent(b)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setPayload(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando datos');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(bodega); }, [bodega, load]);

  /** Optimistic local recompute with the imported engine, then persist + refetch. */
  const commitEdit = useCallback(async (
    row: ApiRow,
    kind: 'transito' | 'pendiente',
    qty: number,
  ) => {
    setSaveError(null);
    setPayload((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((r) => {
        if (r.productId !== row.productId) return r;
        const pending = kind === 'pendiente' ? qty : r.pending;
        const trans = kind === 'transito' ? qty : r.trans;
        const exist = r.existencias - r.reserved - (pending ?? 0);
        const er = engineRowOf(r, exist, trans);
        return {
          ...r, pending, trans, exist,
          transOverridden: kind === 'transito' ? true : r.transOverridden,
          doh: dohOf(er), sug: sugerido(er, trans),
          flags: { ...r.flags, pendingUnknown: pending === null },
        };
      });
      return { ...prev, rows };
    });
    try {
      const res = await fetch(`/api/compras/reabastecimiento/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: row.productId, bodega, qty }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      load(bodega, true); // reconcile with server truth
    } catch (e) {
      setSaveError(`No se guardó el cambio de ${kind} (${row.cod}): ${e instanceof Error ? e.message : e}`);
      load(bodega, true); // restore server truth
    }
  }, [bodega, load]);

  const provList = useMemo(
    () => [...new Set((payload?.rows ?? []).map((r) => r.prov).filter(Boolean))].sort(),
    [payload],
  );

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (payload?.rows ?? [])
      .filter((r) => {
        if (prov && r.prov !== prov) return false;
        if (query && !(r.cod.toLowerCase().includes(query) || r.desc.toLowerCase().includes(query)))
          return false;
        if (onlySug && r.sug <= 0) return false;
        if (onlyCrit && r.doh >= 3) return false;
        return true;
      })
      // Active products first (any demand or stock), urgency (DOH asc) within;
      // dead zero-velocity/zero-stock rows sink to the bottom instead of
      // dominating the first screen.
      .sort((a, b) => {
        const aActive = a.p3 > 0 || a.exist > 0 || a.sug > 0 ? 1 : 0;
        const bActive = b.p3 > 0 || b.exist > 0 || b.sug > 0 ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return a.doh - b.doh;
      });
  }, [payload, q, prov, onlySug, onlyCrit]);

  const kpis = useMemo(() => {
    const need = list.filter((r) => r.sug > 0);
    return {
      total: list.length,
      need: need.length,
      totSug: need.reduce((a, r) => a + r.sug, 0),
      crit: list.filter((r) => r.doh < 3).length,
    };
  }, [list]);

  const topProv = useMemo(() => {
    const by: Record<string, { sug: number; crit: number }> = {};
    for (const r of payload?.rows ?? []) {
      if (!r.prov) continue;
      by[r.prov] = by[r.prov] || { sug: 0, crit: 0 };
      by[r.prov].sug += r.sug;
      if (r.doh < 3 && r.sug > 0) by[r.prov].crit += 1;
    }
    const arr = Object.entries(by).map(([p, v]) => ({ p, ...v }))
      .sort((a, b) => b.sug - a.sug).slice(0, 8);
    return { arr, max: Math.max(1, ...arr.map((a) => a.sug)) };
  }, [payload]);

  const sync = payload?.meta.lastSync ?? null;
  const noData = !loading && !error && (payload?.rows.length ?? 0) === 0;

  return (
    <div className="p-6 max-w-[1240px] mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reabastecimiento en Vivo</h1>
          <p className="text-sm text-gray-500">
            Datos Odoo sincronizados — mismo motor verificado del Excel, con captura en línea
          </p>
        </div>
        <div className="flex-1" />
        <div className="inline-flex rounded-lg bg-gray-100 p-1">
          {(payload?.bodegas ?? ['General']).map((b) => (
            <button
              key={b}
              onClick={() => setBodega(b)}
              className={`px-3 py-1.5 text-sm rounded-md transition ${
                bodega === b ? 'bg-teal-700 text-white font-semibold' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
        <button
          onClick={() => load(bodega)}
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:text-gray-900"
        >
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>

      {/* Freshness */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        {sync ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border ${
            sync.status === 'success'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : sync.status === 'failed'
                ? 'bg-red-50 text-red-700 border-red-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}>
            <PackageCheck size={13} />
            {sync.counts?.data_horizon
              ? `Datos de Odoo al ${new Date(sync.counts.data_horizon.replace(' ', 'T') + 'Z').toLocaleString('es-GT')}`
              : `Última sincronización Odoo: ${sync.status}`}
            {payload?.meta.asOf ? ` · sincronizado ${new Date(payload.meta.asOf).toLocaleString('es-GT')}` : ''}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-700 px-2.5 py-1 border border-amber-200">
            <CloudOff size={13} /> Aún no hay sincronización con Odoo
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 text-gray-600 px-2.5 py-1 border border-gray-200">
          Comercial del mes: {payload?.meta.month ?? '—'}
        </span>
      </div>

      {(error || saveError) && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error ?? saveError}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Productos" value={fmt(kpis.total)} sub={`bodega ${bodega}`} icon={<Boxes size={16} />} />
        <Kpi label="Requieren compra" value={fmt(kpis.need)} sub="sugerido > 0" accent />
        <Kpi label="Unidades sugeridas" value={fmt(kpis.totSug)} sub="total a comprar" accent />
        <Kpi label="Quiebre inminente" value={fmt(kpis.crit)} sub="DOH < 3 días" danger />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_290px] gap-4 items-start">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex flex-wrap gap-2 items-center p-3 border-b border-gray-100">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar código o descripción…"
                className="w-full pl-8 pr-2 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <select
              value={prov}
              onChange={(e) => setProv(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-2 max-w-[180px]"
            >
              <option value="">Todos los proveedores</option>
              {provList.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <label className="text-xs text-gray-600 inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={onlySug} onChange={(e) => setOnlySug(e.target.checked)} /> Solo con sugerido
            </label>
            <label className="text-xs text-gray-600 inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={onlyCrit} onChange={(e) => setOnlyCrit(e.target.checked)} /> Solo quiebre
            </label>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-gray-500">Cargando datos en vivo…</div>
          ) : noData ? (
            <div className="p-10 text-center text-sm text-gray-500">
              <CloudOff size={22} className="mx-auto mb-2 text-gray-400" />
              Sin datos para <b>{bodega}</b> — la sincronización con Odoo aún no ha corrido.
            </div>
          ) : (
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                    <Th left>Código</Th>
                    <Th left>Descripción / Proveedor</Th>
                    <Th>Exist. neta</Th>
                    <Th>Patio</Th>
                    <Th>DOH</Th>
                    <Th><span className="inline-flex items-center gap-1">Tránsito <Pencil size={11} /></span></Th>
                    <Th><span className="inline-flex items-center gap-1">Pend. reserva <Pencil size={11} /></span></Th>
                    <Th>Adic.</Th>
                    <Th>Sugerido</Th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {list.slice(0, 400).map((r) => {
                    const band = sev(r.doh);
                    return (
                      <tr key={r.productId} className="hover:bg-teal-50/50">
                        <td className="px-3 py-2 border-b border-gray-100 text-left">{r.cod}</td>
                        <td className="px-3 py-2 border-b border-gray-100 text-left">
                          <div className="truncate max-w-[240px] text-gray-800">{r.desc}</div>
                          <div className="text-gray-400 text-xs">{r.prov}</div>
                        </td>
                        <td className="px-3 py-2 border-b border-gray-100 text-right"
                            title={`existencias ${fmt(r.existencias)} − reservado ${fmt(r.reserved)} − pendiente ${r.pending ?? '¿?'}`}>
                          {fmt(r.exist)}
                        </td>
                        <td className="px-3 py-2 border-b border-gray-100 text-right text-gray-500">{fmt(r.patio)}</td>
                        <td className="px-3 py-2 border-b border-gray-100 text-right">
                          <span className={`inline-block min-w-[44px] text-center px-2 py-0.5 rounded-full font-semibold text-xs ${SEV_PILL[band]}`}>
                            {r.doh.toFixed(1)}
                          </span>
                        </td>
                        <td className="px-3 py-2 border-b border-gray-100 text-right">
                          <QtyInput
                            value={r.trans}
                            edited={r.transOverridden}
                            label={`Tránsito ${r.cod}`}
                            onCommit={(v) => commitEdit(r, 'transito', v)}
                          />
                        </td>
                        <td className="px-3 py-2 border-b border-gray-100 text-right">
                          <QtyInput
                            value={r.pending}
                            edited={r.pending !== null}
                            unknown={r.flags.pendingUnknown}
                            label={`Pendiente de tomar reserva ${r.cod}`}
                            onCommit={(v) => commitEdit(r, 'pendiente', v)}
                          />
                        </td>
                        <td className="px-3 py-2 border-b border-gray-100 text-right text-gray-500">{fmt(r.adic)}</td>
                        <td className={`px-3 py-2 border-b border-gray-100 text-right font-bold ${r.sug > 0 ? 'text-teal-700' : 'text-gray-400'}`}
                            title={r.flags.seasonalLowConfidence ? 'Estacional sin datos — confianza baja' : undefined}>
                          {fmt(r.sug)}{r.flags.seasonalLowConfidence ? <span className="text-amber-500">*</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-xs text-gray-500 px-3 py-2.5 border-t border-gray-100">
            Mostrando <b>{Math.min(400, list.length)}</b> de <b>{list.length}</b> productos
            {list.length > 400 ? ' (primeros 400 — refiná con filtros)' : ''} · bodega <b>{bodega}</b>
            {' '}· <span className="text-amber-600">*</span> = estacional con confianza baja
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold px-4 py-3 border-b border-gray-100">
              Top afectaciones por proveedor
            </h2>
            <ul>
              {topProv.arr.map((a) => (
                <li key={a.p} className="px-4 py-2.5 border-b border-gray-100 last:border-0">
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span className="truncate text-gray-800">{a.p}</span>
                    <b className="tabular-nums">{fmt(a.sug)}</b>
                  </div>
                  <div
                    className="h-1.5 rounded mt-1.5"
                    style={{
                      width: `${((a.sug / topProv.max) * 100).toFixed(0)}%`,
                      background: a.crit > 0 ? '#c0392b' : '#0e7c86',
                    }}
                  />
                  <div className="text-xs text-gray-400 mt-0.5">{a.crit} en quiebre</div>
                </li>
              ))}
              {topProv.arr.length === 0 && (
                <li className="px-4 py-3 text-xs text-gray-400">Sin datos aún.</li>
              )}
            </ul>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2 flex items-center gap-1">
              <AlertTriangle size={13} /> Cómo se calcula
            </h2>
            <p className="text-xs text-gray-500 leading-relaxed">
              Mismo motor verificado del Excel (99.85% de paridad). Exist. neta = existencias − reservado −
              pendiente de tomar reserva (captura manual — <b>¿?</b> significa sin dato, no cero).
              El patio se muestra aparte y no entra al cálculo, igual que en el Excel.
              Tránsito editable: tu valor manual reemplaza al sincronizado (p. ej. el mensual de Carvajal).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Th({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return (
    <th className={`${left ? 'text-left' : 'text-right'} font-semibold px-3 py-2.5 border-b border-gray-200 whitespace-nowrap`}>
      {children}
    </th>
  );
}

function QtyInput({ value, edited, unknown, label, onCommit }: {
  value: number | null;
  edited: boolean;
  unknown?: boolean;
  label: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string>(value === null ? '' : String(Math.round(value)));
  useEffect(() => { setDraft(value === null ? '' : String(Math.round(value))); }, [value]);
  const commit = () => {
    if (draft.trim() === '') return; // unknown stays unknown until a number is entered
    const v = parseFloat(draft);
    if (Number.isFinite(v) && v >= 0 && v !== value) onCommit(v);
  };
  return (
    <span className="inline-flex items-center gap-1">
      {unknown && <span title="Sin dato — no es cero" className="text-gray-400 font-bold">¿?</span>}
      <input
        type="number"
        min={0}
        value={draft}
        placeholder={unknown ? '—' : undefined}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className={`w-[72px] text-right tabular-nums px-1.5 py-1 border rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600 ${
          edited ? 'border-teal-500 ring-1 ring-teal-500' : 'border-gray-200'
        }`}
      />
    </span>
  );
}

function Kpi({ label, value, sub, icon, accent, danger }: {
  label: string; value: string; sub: string;
  icon?: React.ReactNode; accent?: boolean; danger?: boolean;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold flex items-center gap-1">
        {icon} {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${
        danger ? 'text-red-600' : accent ? 'text-teal-700' : 'text-gray-900'
      }`}>
        {value}
      </div>
      <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}
