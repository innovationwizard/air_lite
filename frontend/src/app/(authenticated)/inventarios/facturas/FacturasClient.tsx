'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, FileUp, Loader2, Truck, X,
} from 'lucide-react';
import { DESTINOS, nombreDestino } from '@/lib/reyma/destinos';
import { diasHabilesDe, sumarDiasHabiles, type EtaConfig } from '../reyma-vivo/eta';

/**
 * Carga de facturas de REYMA — la pantalla de Alexis (A12).
 *
 * TRES PANTALLAS, en una sola página: soltar → confirmar → recibo.
 *
 * El principio de diseño, que explica casi todas las decisiones de abajo: esto
 * **no es un formulario de carga, es una pantalla de confirmación**. De los
 * siete campos que hacen falta, la máquina lee cinco del documento y los valida
 * contra su propio total impreso. Los únicos dos que no puede saber — y que no
 * podría saber ni con un parser perfecto — son el DESTINO y el ETA. Esos dos
 * son el producto de esta pantalla; todo lo demás se muestra apenas lo
 * suficiente para que Alexis reconozca que la máquina leyó bien.
 *
 * Lo que NO se pide, a propósito:
 *   · revisar línea por línea — si una línea estuviera mal leída la suma no
 *     cuadraría y el parser se habría negado a cargar. Pedir que confirme lo
 *     que la aritmética ya confirmó entrena el reflejo de aprobar sin mirar,
 *     que es justo lo que arruina el campo donde su confirmación SÍ vale.
 *   · tipo de cambio, folio fiscal, PV, operador — están en el documento.
 *   · la orden de compra — la conciliación contra Odoo es un motor aparte.
 */

interface Retenida {
  guia: string; identificador: string; descripcion: string;
  cantidad: number; unidad: string; importe: number | null; motivo: string;
}
interface LineaCruda {
  linea: number; cantidad: number; unidad: string; identificador: string;
  descripcion: string; precio_unitario: number; importe: number;
}
interface Cabecera {
  factura: string; pv: string | null; folio_fiscal: string;
  fecha: string; hora: string | null; t_cambio: string | null;
  total: string | null; suma_importes: number; paginas: string;
  op: string | null; oc_in_band: string | null; conf: string | null;
  observ_destino: string | null; destino_in_band: string | null;
}
interface Parse {
  ok: boolean; archivo: string; sha256: string; guia: string | null;
  cabecera: Cabecera | null; cuadra: boolean; flags: string[];
  lineas: LineaCruda[]; filas: { cantidad: number }[]; retenidas: Retenida[]; errores: string[];
}

type EstadoTarjeta = 'leyendo' | 'lista' | 'bloqueada' | 'guardando' | 'cargada' | 'duplicada';

interface Tarjeta {
  id: string;
  nombre: string;
  estado: EstadoTarjeta;
  ticket?: string;
  parse?: Parse;
  error?: string;
  destino: string | null;
  eta: string;
  detalleAbierto: boolean;
  recibo?: { guia: string | null; factura: string | null; lineas: number; cajas: number };
  existente?: { guia: string; factura: string; destino: string | null; eta: string | null };
}

interface Serie { desde: string; hasta: string; huecos: string[] }
interface FacturaCargada {
  guia: string; factura: string; destino: string | null; fecha: string;
  eta: string | null; lineas: number; cajas: number;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-08-25' → '25 ago'. Fechas de calendario: se parsean a mano, sin `new Date(iso)`. */
function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]}`;
}

/** '24/08/2026' → '2026-08-24' */
function cfdiAIso(fecha: string | null | undefined): string | null {
  if (!fecha || !/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) return null;
  return `${fecha.slice(6, 10)}-${fecha.slice(3, 5)}-${fecha.slice(0, 2)}`;
}

function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let contador = 0;
const nuevoId = () => `t${(contador += 1)}`;

export function FacturasClient({ etaConfig }: { etaConfig: EtaConfig }) {
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [cargadas, setCargadas] = useState<FacturaCargada[]>([]);
  const [serie, setSerie] = useState<Serie | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const actualizar = useCallback((id: string, cambio: Partial<Tarjeta>) => {
    setTarjetas((prev) => prev.map((t) => (t.id === id ? { ...t, ...cambio } : t)));
  }, []);

  const recargarSerie = useCallback(async () => {
    try {
      const r = await fetch('/api/inventarios/reyma/factura/cargar');
      if (!r.ok) return;
      const j = (await r.json()) as { facturas: FacturaCargada[]; serie: Serie | null };
      setCargadas(j.facturas ?? []);
      setSerie(j.serie ?? null);
    } catch {
      // El recibo es informativo; si no carga, no se bloquea nada.
    }
  }, []);

  useEffect(() => { void recargarSerie(); }, [recargarSerie]);

  /** Paso 1 — subir y leer. Varios archivos a la vez: Alexis manda ráfagas. */
  const subir = useCallback(async (archivos: FileList | File[]) => {
    const lista = Array.from(archivos);
    if (lista.length === 0) return;

    const nuevas: Tarjeta[] = lista.map((f) => ({
      id: nuevoId(), nombre: f.name, estado: 'leyendo',
      destino: null, eta: '', detalleAbierto: false,
    }));
    setTarjetas((prev) => [...nuevas, ...prev]);

    await Promise.all(lista.map(async (archivo, i) => {
      const id = nuevas[i].id;
      const fd = new FormData();
      fd.append('pdf', archivo);
      try {
        const r = await fetch('/api/inventarios/reyma/factura/extraer', { method: 'POST', body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          actualizar(id, { estado: 'bloqueada', error: j.error ?? `HTTP ${r.status}` });
          return;
        }
        if (j.yaCargada) {
          actualizar(id, { estado: 'duplicada', parse: j.parse, existente: j.existente });
          return;
        }
        const parse = j.parse as Parse;
        const bloqueada = !parse.cuadra || parse.errores.length > 0;
        actualizar(id, {
          estado: bloqueada ? 'bloqueada' : 'lista',
          ticket: j.ticket,
          parse,
          // El destino viene marcado SÓLO si la propia factura lo declara
          // (N10). Si no lo dice, no hay valor por defecto: un default
          // silencioso es como las cajas de Zacapa terminan descontando la
          // orden de San José (N13).
          destino: parse.cabecera?.destino_in_band ?? null,
          error: bloqueada
            ? (parse.errores[0] ?? 'La suma de las líneas no cuadra con el total impreso.')
            : undefined,
        });
      } catch (e) {
        actualizar(id, { estado: 'bloqueada', error: e instanceof Error ? e.message : 'error de red' });
      }
    }));
  }, [actualizar]);

  /** Paso 2 — confirmar destino y ETA, y escribir. */
  const guardar = useCallback(async (t: Tarjeta) => {
    if (!t.ticket || !t.destino) return;
    actualizar(t.id, { estado: 'guardando', error: undefined });
    try {
      const r = await fetch('/api/inventarios/reyma/factura/cargar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: t.ticket, destino: t.destino, eta: t.eta || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        actualizar(t.id, { estado: 'lista', error: j.error ?? `HTTP ${r.status}` });
        return;
      }
      actualizar(t.id, {
        estado: 'cargada',
        recibo: { guia: j.guia, factura: j.factura, lineas: j.lineas, cajas: j.cajas },
      });
      void recargarSerie();
    } catch (e) {
      actualizar(t.id, { estado: 'lista', error: e instanceof Error ? e.message : 'error de red' });
    }
  }, [actualizar, recargarSerie]);

  const pendientes = tarjetas.filter((t) => t.estado !== 'cargada');
  const reciboDelDia = tarjetas.filter((t) => t.estado === 'cargada');

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Truck className="h-5 w-5 text-emerald-600" />
          Cargar facturas de REYMA
        </h1>
        <p className="mt-1 text-[13px] leading-snug text-slate-600">
          Soltá los PDF que te manda la fábrica. La app los lee sola; vos decís nada más
          <strong> a qué bodega van</strong> y <strong>cuándo llegan</strong>.
        </p>
      </header>

      {/* ── PANTALLA 1 · SOLTAR ─────────────────────────────────────────── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          void subir(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          arrastrando ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 bg-white'
        }`}
      >
        <FileUp className="mx-auto h-8 w-8 text-slate-400" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-emerald-600 px-5 text-[15px] font-semibold text-white hover:bg-emerald-700 active:bg-emerald-800"
        >
          Elegir facturas
        </button>
        <p className="mt-2 text-xs text-slate-500">
          Podés soltar o elegir varias de una vez.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void subir(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* ── PANTALLA 2 · CONFIRMAR ──────────────────────────────────────── */}
      {pendientes.map((t) => (
        <TarjetaFactura
          key={t.id}
          t={t}
          etaConfig={etaConfig}
          onCambio={(c) => actualizar(t.id, c)}
          onGuardar={() => void guardar(t)}
          onDescartar={() => setTarjetas((prev) => prev.filter((x) => x.id !== t.id))}
        />
      ))}

      {/* ── PANTALLA 3 · RECIBO ─────────────────────────────────────────── */}
      {reciboDelDia.length > 0 && (
        <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="text-sm font-semibold text-emerald-900">
            Cargadas en esta sesión ({reciboDelDia.length})
          </h2>
          <ul className="mt-2 space-y-1.5">
            {reciboDelDia.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-[13px] text-emerald-900">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>
                  <strong>{t.recibo?.guia ?? t.nombre}</strong>
                  {t.recibo?.factura ? ` · ${t.recibo.factura}` : ''} — {t.recibo?.lineas} líneas,{' '}
                  {t.recibo?.cajas.toLocaleString('es-GT')} cajas · {nombreDestino(t.destino)}
                  {t.eta ? ` · llega ${fechaCorta(t.eta)}` : ' · sin ETA anotado'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SeriePanel serie={serie} cargadas={cargadas} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function TarjetaFactura({
  t, etaConfig, onCambio, onGuardar, onDescartar,
}: {
  t: Tarjeta;
  etaConfig: EtaConfig;
  onCambio: (c: Partial<Tarjeta>) => void;
  onGuardar: () => void;
  onDescartar: () => void;
}) {
  const cab = t.parse?.cabecera ?? null;
  const fechaFactura = cfdiAIso(cab?.fecha);

  // «ETA App»: la fórmula (fecha impresa + N días hábiles por bodega). Se
  // muestra como PISTA, nunca se guarda por él. Si Alexis no escribe nada, la
  // columna «ETA Alexis» queda vacía y la app sigue calculando — que es la
  // verdad, y es lo que las dos columnas de `reyma-vivo` hacen visible.
  const etaApp = fechaFactura && t.destino
    ? sumarDiasHabiles(fechaFactura, diasHabilesDe(t.destino, etaConfig))
    : null;

  if (t.estado === 'leyendo') {
    return (
      <Marco>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Leyendo <span className="font-medium">{t.nombre}</span>…
        </div>
      </Marco>
    );
  }

  if (t.estado === 'duplicada') {
    // No es un error: Alexis manda ráfagas y bien puede reenviar una.
    return (
      <Marco tono="slate">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm text-slate-700">
            <strong>{t.existente?.guia ?? t.nombre}</strong> ya estaba cargada
            {t.existente?.destino ? ` · ${nombreDestino(t.existente.destino)}` : ''}
            {t.existente?.eta ? ` · llega ${fechaCorta(t.existente.eta)}` : ''}.
            <div className="mt-0.5 text-xs text-slate-500">No se cargó de nuevo. No hace falta hacer nada.</div>
          </div>
          <BotonCerrar onClick={onDescartar} />
        </div>
      </Marco>
    );
  }

  if (t.estado === 'bloqueada') {
    return (
      <Marco tono="ambar">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900">
              <strong>{cab?.factura ?? t.nombre}</strong> no se puede cargar.
              <div className="mt-1 text-[13px] leading-snug">{t.error}</div>
              <div className="mt-2 text-xs text-amber-800">
                No se cargó nada de esta factura. Mandásela a Jorge tal como está.
              </div>
            </div>
          </div>
          <BotonCerrar onClick={onDescartar} />
        </div>
      </Marco>
    );
  }

  const guardando = t.estado === 'guardando';

  return (
    <Marco>
      {/* Identidad + semáforo del total. Es la única señal de confianza que
          hace falta: el parseo es determinístico, así que o la aritmética del
          documento cierra o no. */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-slate-900">
            {t.parse?.guia ?? t.nombre}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {cab?.factura} · {cab?.fecha}
            {cab?.pv ? ` · ${cab.pv}` : ''}
          </div>
        </div>
        <BotonCerrar onClick={onDescartar} />
      </div>

      <button
        type="button"
        onClick={() => onCambio({ detalleAbierto: !t.detalleAbierto })}
        className="mt-2 flex w-full items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-left text-[13px] font-medium text-emerald-800"
      >
        <Check className="h-4 w-4 shrink-0" />
        <span>
          {t.parse?.lineas.length} líneas · ${cab?.total} cuadra
        </span>
        {t.detalleAbierto
          ? <ChevronDown className="ml-auto h-4 w-4" />
          : <ChevronRight className="ml-auto h-4 w-4" />}
      </button>

      {t.detalleAbierto && (
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1 text-left font-semibold">Clave</th>
                <th className="px-2 py-1 text-right font-semibold">Cant.</th>
                <th className="px-2 py-1 text-left font-semibold">Un.</th>
                <th className="px-2 py-1 text-right font-semibold">Importe</th>
              </tr>
            </thead>
            <tbody>
              {t.parse?.lineas.map((l) => (
                <tr key={l.linea} className="border-t border-slate-100">
                  <td className="px-2 py-1 font-mono">{l.identificador}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {l.cantidad.toLocaleString('es-GT')}
                  </td>
                  <td className="px-2 py-1">{l.unidad}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {l.importe.toLocaleString('es-GT', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Lo retenido se anuncia con números — nunca en silencio (G-231). */}
      {t.parse && t.parse.retenidas.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <strong>{t.parse.retenidas.length} línea{t.parse.retenidas.length === 1 ? '' : 's'} no se
          {t.parse.retenidas.length === 1 ? ' carga' : ' cargan'}</strong>
          {' — el resto de la factura sí.'}
          <ul className="mt-1 space-y-0.5">
            {t.parse.retenidas.map((r, i) => (
              <li key={i}>
                {r.identificador} ({r.cantidad.toLocaleString('es-GT')} {r.unidad}): {r.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Campo 1 de 2: DESTINO ──────────────────────────────────────── */}
      <fieldset className="mt-4">
        <legend className="text-[13px] font-semibold text-slate-700">¿A dónde va?</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {DESTINOS.map((d) => {
            const activo = t.destino === d.id;
            return (
              <button
                key={d.id}
                type="button"
                disabled={guardando}
                onClick={() => onCambio({ destino: d.id, error: undefined })}
                className={`min-h-[52px] rounded-lg border-2 px-3 py-2 text-left transition-colors ${
                  activo
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="text-[14px] font-semibold leading-tight">{d.nombre}</div>
                {d.detalle && <div className="text-[11px] text-slate-500">{d.detalle}</div>}
              </button>
            );
          })}
        </div>
        {cab?.destino_in_band ? (
          <p className="mt-1.5 text-[11px] text-slate-500">
            Lo dice la factura: «{cab.observ_destino}».
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] text-slate-500">
            Esta factura no dice a dónde va — elegilo vos.
          </p>
        )}
      </fieldset>

      {/* ── Campo 2 de 2: ETA ──────────────────────────────────────────── */}
      <div className="mt-4">
        <label htmlFor={`eta-${t.id}`} className="text-[13px] font-semibold text-slate-700">
          ¿Cuándo llega?
        </label>
        <input
          id={`eta-${t.id}`}
          type="date"
          value={t.eta}
          disabled={guardando}
          min={fechaFactura ?? undefined}
          onChange={(e) => onCambio({ eta: e.target.value, error: undefined })}
          className="mt-1.5 block min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-[15px] text-slate-900"
        />
        <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
          {etaApp
            ? <>Si lo dejás vacío, la app calcula <strong>{fechaCorta(etaApp)}</strong>.</>
            : 'Si lo dejás vacío, la app lo calcula sola.'}
          {' '}Podés poner una fecha ya pasada si el furgón ya entró.
          {t.eta && t.eta <= hoyIso() && (
            <span className="ml-1 font-medium text-slate-700">Esa fecha ya pasó — se anota como ya llegado.</span>
          )}
        </p>
      </div>

      {t.error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          {t.error}
        </div>
      )}

      <button
        type="button"
        disabled={!t.destino || guardando}
        onClick={onGuardar}
        className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-[15px] font-semibold text-white disabled:bg-slate-300 disabled:text-slate-500 hover:bg-emerald-700 active:bg-emerald-800"
      >
        {guardando ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : 'Guardar'}
      </button>
      {!t.destino && (
        <p className="mt-1.5 text-center text-[11px] text-slate-500">Elegí el destino para poder guardar.</p>
      )}
    </Marco>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function SeriePanel({ serie, cargadas }: { serie: Serie | null; cargadas: FacturaCargada[] }) {
  if (!serie) return null;
  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Furgones cargados</h2>
      <p className="mt-1 text-[13px] text-slate-600">
        Serie <strong>{serie.desde} → {serie.hasta}</strong>
        {serie.huecos.length === 0
          ? <span className="ml-1 text-emerald-700">· sin huecos ✓</span>
          : (
            <span className="ml-1 text-amber-700">
              · faltan {serie.huecos.join(', ')} — ¿los mandaste?
            </span>
          )}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] text-[12px]">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-1 text-left font-semibold">Furgón</th>
              <th className="px-2 py-1 text-left font-semibold">Destino</th>
              <th className="px-2 py-1 text-right font-semibold">Cajas</th>
              <th className="px-2 py-1 text-left font-semibold">ETA Alexis</th>
              <th className="px-2 py-1 text-left font-semibold">Factura</th>
            </tr>
          </thead>
          <tbody>
            {cargadas.slice(0, 12).map((f) => (
              <tr key={f.guia} className="border-t border-slate-100">
                <td className="px-2 py-1 font-medium">{f.guia.replace('-2026', '')}</td>
                <td className="px-2 py-1">{nombreDestino(f.destino)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{f.cajas.toLocaleString('es-GT')}</td>
                <td className={`px-2 py-1 ${f.eta ? 'font-medium text-slate-800' : 'text-slate-400'}`}>
                  {f.eta ? fechaCorta(f.eta) : '—'}
                </td>
                <td className="px-2 py-1">{fechaCorta(f.fecha)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Marco({ children, tono = 'blanco' }: { children: React.ReactNode; tono?: 'blanco' | 'ambar' | 'slate' }) {
  const cls = tono === 'ambar'
    ? 'border-amber-300 bg-amber-50'
    : tono === 'slate'
      ? 'border-slate-200 bg-slate-50'
      : 'border-slate-200 bg-white';
  return <section className={`mt-4 rounded-xl border p-4 ${cls}`}>{children}</section>;
}

function BotonCerrar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Quitar de la lista"
      className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
