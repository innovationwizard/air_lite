'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Info, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  computeReplica,
  estadoMatches,
  fmt,
  type DayBlockDerived,
  type Edits,
  type ModeloDerived,
  type ReymaData,
  type SaldosDerived,
  type VentasDerived,
} from './engine';

// ---------------------------------------------------------------- ui helpers

const TH = 'px-2 py-1.5 text-left font-semibold text-slate-600 whitespace-nowrap';
const THR = 'px-2 py-1.5 text-right font-semibold text-slate-600 whitespace-nowrap';
const TD = 'px-2 py-1 whitespace-nowrap';
const TDR = 'px-2 py-1 text-right whitespace-nowrap tabular-nums';

/** Cantidades: enteras sin decimales; fraccionarias con los decimales reales (hasta 3). */
function qty(n: number): string {
  return Number.isInteger(n) ? fmt(n) : fmt(n, 3);
}
function m3(n: number): string {
  return fmt(n, 2);
}
function pct(n: number, dp = 1): string {
  return `${(n * 100).toLocaleString('es-GT', { minimumFractionDigits: dp, maximumFractionDigits: dp })}%`;
}
function usd(n: number): string {
  return fmt(n, 2);
}

function estadoChip(estado: string | null) {
  if (!estado) return <span className="text-slate-300">—</span>;
  const cls = estadoMatches(estado, 'transito')
    ? 'bg-amber-100 text-amber-800'
    : estadoMatches(estado, 'entrega')
      ? 'bg-orange-100 text-orange-700'
      : estadoMatches(estado, 'recibido')
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-slate-100 text-slate-600';
  return <span className={`inline-block rounded px-1 py-0.5 text-[10px] font-semibold ${cls}`}>{estado}</span>;
}

function prioridadChip(o: string) {
  const cls = o.startsWith('CRITICO')
    ? 'bg-red-100 text-red-700'
    : o.startsWith('PRECAUCION')
      ? 'bg-amber-100 text-amber-700'
      : 'bg-emerald-100 text-emerald-700';
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{o}</span>;
}

/** DD-MMM-YYYY (meses en inglés, como el libro) → Date, para la regla del semáforo. */
const MESES: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
function parseFecha(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mon = MESES[m[2].toLowerCase()];
  if (mon === undefined) return null;
  return new Date(Number(m[3]), mon, Number(m[1]));
}

interface EditNumProps {
  value: number;
  edited: boolean;
  onChange: (v: number) => void;
  width?: string;
}
function EditNum({ value, edited, onChange, width = 'w-20' }: EditNumProps) {
  return (
    <input
      type="number"
      value={value}
      step="any"
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className={`${width} rounded border px-1 py-0.5 text-right text-xs tabular-nums bg-yellow-50 focus:outline-none focus:ring-1 focus:ring-blue-400 ${
        edited ? 'border-amber-500 ring-1 ring-amber-400' : 'border-yellow-300'
      }`}
      title={edited ? 'Editado en pantalla (no guardado) — el libro dice otro valor' : 'Celda editable (amarilla en el libro)'}
    />
  );
}

function ParityFooter({ data, sheets }: { data: ReymaData; sheets: string[] }) {
  const p = data.parity.python;
  const tot = sheets.reduce((a, s) => a + (p[s]?.total ?? 0), 0);
  const match = sheets.reduce((a, s) => a + (p[s]?.match ?? 0), 0);
  if (!tot) return null;
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700">
      <ShieldCheck className="h-3.5 w-3.5" />
      Paridad con el libro: {fmt(match)}/{fmt(tot)} celdas calculadas = valores de Alexis (verificado también por tests del motor TS).
    </div>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 mb-4">
      {title ? <h3 className="text-sm font-semibold text-slate-700 mb-2">{title}</h3> : null}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- tabs

const TABS = [
  { id: 'modelo', label: 'Modelo' },
  { id: 'oc', label: 'Orden Compra' },
  { id: 'ventas', label: 'Ventas 24-26' },
  { id: 'saldos', label: 'Saldos Julio' },
  { id: 'entregas', label: 'Entregas Directas' },
  { id: 'mrp', label: 'Planificación MRP' },
  { id: 'despachos', label: 'Despachos' },
  { id: 'alertas', label: 'Alertas' },
  { id: 'nc', label: 'NC Duroport' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'bd', label: 'BD Inventarios' },
  { id: 'junio', label: 'Saldos Junio (legacy)' },
  { id: 'hallazgos', label: 'Hallazgos' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function ReymaClient({ data }: { data: ReymaData }) {
  const [tab, setTab] = useState<TabId>('modelo');
  const [edits, setEdits] = useState<Edits>({ proyeccion: {}, cajas: {}, tarifaNc: null });

  const c = useMemo(() => computeReplica(data, edits), [data, edits]);
  const nEdits =
    Object.keys(edits.proyeccion).length + Object.keys(edits.cajas).length + (edits.tarifaNc !== null ? 1 : 0);
  const warns = data.findings.filter((f) => f.severity === 'warn').length;
  const extractedDate = useMemo(() => new Date(data.provenance.extractedAt), [data.provenance.extractedAt]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header + honest data-horizon banner */}
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Modelo Reyma — Réplica del libro de Alexis</h1>
          {nEdits > 0 && (
            <button
              onClick={() => setEdits({ proyeccion: {}, cajas: {}, tarifaNc: null })}
              className="inline-flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              <RotateCcw className="h-3 w-3" /> Restaurar valores del libro ({nEdits})
            </button>
          )}
        </div>
        <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          Réplica 1:1 del archivo <span className="font-mono">{data.provenance.sourceFile}</span> (SHA-256{' '}
          <span className="font-mono">{data.provenance.sourceSha256.slice(0, 8)}…</span>, extraído{' '}
          {extractedDate.toLocaleDateString('es-GT')}). <strong>No son datos en vivo</strong> — la fase 2 conecta
          Odoo. Las celdas amarillas son editables como en Excel: al cambiarlas recalcula todo; los cambios son
          locales y no se guardan.
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 -mb-px whitespace-nowrap ${
              tab === t.id
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            {t.id === 'hallazgos' && warns > 0 ? (
              <span className="ml-1 rounded-full bg-amber-200 px-1.5 text-[10px] font-bold text-amber-900">{warns}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'modelo' && <TabModelo data={data} c={c} edits={edits} setEdits={setEdits} />}
      {tab === 'oc' && <TabOrdenCompra data={data} c={c} />}
      {tab === 'ventas' && <TabVentas data={data} c={c} />}
      {tab === 'saldos' && <TabSaldos data={data} c={c} asOf={extractedDate} />}
      {tab === 'entregas' && <TabEntregas data={data} />}
      {tab === 'mrp' && <TabMrp data={data} c={c} />}
      {tab === 'despachos' && <TabDespachos data={data} c={c} edits={edits} setEdits={setEdits} />}
      {tab === 'alertas' && <TabAlertas data={data} />}
      {tab === 'nc' && <TabNc data={data} c={c} edits={edits} setEdits={setEdits} />}
      {tab === 'dashboard' && <TabDashboard data={data} c={c} />}
      {tab === 'bd' && <TabBd data={data} />}
      {tab === 'junio' && <TabJunio data={data} />}
      {tab === 'hallazgos' && <TabHallazgos data={data} />}
    </div>
  );
}

type Computed = ReturnType<typeof computeReplica>;

// ---------------------------------------------------------------- MODELO

function TabModelo({
  data,
  c,
  edits,
  setEdits,
}: {
  data: ReymaData;
  c: Computed;
  edits: Edits;
  setEdits: (e: Edits) => void;
}) {
  return (
    <SectionCard title={data.modelo.titulo}>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className={TH}>Código</th>
              <th className={TH}>Clave</th>
              <th className={TH}>Descripción</th>
              <th className={TH}>Categoría</th>
              <th className={THR}>Cub m³</th>
              <th className={THR}>Precio USD</th>
              <th className={THR}>San José</th>
              <th className={THR}>Zona 11</th>
              <th className={THR}>Petén</th>
              <th className={THR}>Zacapa</th>
              <th className={THR}>Patios SJ</th>
              <th className={THR}>Pend. x Surtir</th>
              <th className={THR}>Inv. Disp.</th>
              <th className={THR}>Tránsito</th>
              <th className={THR}>
                Proyección{' '}
                <span title='El encabezado del libro dice "Prom Jul-Ago" pero la fórmula promedia Ene-Jun 2026 (hallazgo F1). Definición pendiente con Alexis.'>
                  <AlertTriangle className="inline h-3 w-3 text-amber-500" />
                </span>
              </th>
              <th className={THR}>Stock Seg. (1 sem)</th>
              <th className={THR}>Necesidad</th>
              <th className={THR}>Disponible</th>
              <th className={THR}>Pedido Óptimo</th>
              <th className={THR}>Vol. m³</th>
              <th className={THR}>Factor Crec.</th>
            </tr>
          </thead>
          <tbody>
            {data.modelo.rows.map((r) => {
              const d = c.modeloDer.get(r.cod) as ModeloDerived;
              return (
                <tr key={r.cod} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className={`${TD} font-mono`}>{r.cod}</td>
                  <td className={TD}>{r.clave}</td>
                  <td className={`${TD} max-w-[260px] truncate`} title={r.prodReyma}>
                    {r.desc}
                  </td>
                  <td className={TD}>{r.cat}</td>
                  <td className={TDR}>{r.cub.toLocaleString('es-GT', { maximumFractionDigits: 5 })}</td>
                  <td className={TDR}>{usd(r.precio)}</td>
                  <td className={TDR}>{qty(r.sj)}</td>
                  <td className={TDR}>{qty(r.z11)}</td>
                  <td className={TDR}>{qty(r.pet)}</td>
                  <td className={TDR}>{qty(r.zac)}</td>
                  <td className={TDR}>{qty(r.pat)}</td>
                  <td className={TDR}>{qty(r.psx)}</td>
                  <td className={`${TDR} font-medium ${d.n < 0 ? 'text-red-600' : ''}`}>{qty(d.n)}</td>
                  <td className={TDR}>{qty(r.transito)}</td>
                  <td className={TDR}>
                    <span className="inline-flex items-center gap-1">
                      {r.proyOverride && (
                        <span
                          className="rounded bg-purple-100 px-1 text-[9px] font-bold text-purple-700"
                          title="Override manual de Alexis en el libro (no viene de la fórmula)"
                        >
                          AJ
                        </span>
                      )}
                      <EditNum
                        value={edits.proyeccion[r.cod] ?? r.proyeccion}
                        edited={edits.proyeccion[r.cod] !== undefined}
                        onChange={(v) =>
                          setEdits({ ...edits, proyeccion: { ...edits.proyeccion, [r.cod]: v } })
                        }
                      />
                    </span>
                  </td>
                  <td className={TDR}>{qty(d.r)}</td>
                  <td className={TDR}>{qty(d.s)}</td>
                  <td className={TDR}>{qty(d.t)}</td>
                  <td className={`${TDR} font-semibold ${d.u > 0 ? 'text-blue-700' : 'text-slate-400'}`}>{qty(d.u)}</td>
                  <td className={TDR}>{m3(d.v)}</td>
                  <td className={TDR}>{d.w.toLocaleString('es-GT', { maximumFractionDigits: 3 })}</td>
                </tr>
              );
            })}
            {data.modelo.stray ? (
              <tr className="border-t border-slate-200 bg-slate-50 text-slate-400 italic">
                <td className={TD}>{String(data.modelo.stray.cod)}</td>
                <td className={TD}>{String(data.modelo.stray.clave)}</td>
                <td className={`${TD} max-w-[260px] truncate`}>{String(data.modelo.stray.desc)}</td>
                <td className={TD}>{String(data.modelo.stray.cat)}</td>
                <td className={TDR} colSpan={9}>
                  fila suelta del libro (fuera de TOTALES) — ver Hallazgos
                </td>
                <td className={TDR}>{qty(Number(data.modelo.stray.transito))}</td>
                <td className={TDR}>{qty(Number(data.modelo.stray.proyeccion))}</td>
                <td colSpan={6} />
              </tr>
            ) : null}
            <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
              <td className={TD} colSpan={6}>
                TOTALES
              </td>
              <td className={TDR}>{qty(c.modeloTotales.sj)}</td>
              <td className={TDR}>{qty(c.modeloTotales.z11)}</td>
              <td className={TDR}>{qty(c.modeloTotales.pet)}</td>
              <td className={TDR}>{qty(c.modeloTotales.zac)}</td>
              <td className={TDR}>{qty(c.modeloTotales.pat)}</td>
              <td className={TDR}>{qty(c.modeloTotales.psx)}</td>
              <td className={TDR}>{qty(c.modeloTotales.n)}</td>
              <td className={TDR}>{qty(c.modeloTotales.o)}</td>
              <td colSpan={7} />
            </tr>
          </tbody>
        </table>
      </div>
      <ParityFooter data={data} sheets={['MODELO']} />
    </SectionCard>
  );
}

// ---------------------------------------------------------------- ORDEN COMPRA

function TabOrdenCompra({ data, c }: { data: ReymaData; c: Computed }) {
  const e = data.ordenCompra.encabezado;
  return (
    <SectionCard title={e.titulo}>
      <div className="mb-3 grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-slate-600 sm:grid-cols-3">
        <div>{e.empresa}</div>
        <div>
          No. OC: <span className="font-mono">{e.oc}</span>
        </div>
        <div>Fecha: {e.fecha}</div>
        <div>{e.atencion}</div>
        <div>{e.condicion}</div>
        <div>Moneda: {e.moneda}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>#</th>
              <th className={TH}>Código Proveedor</th>
              <th className={TH}>Descripción</th>
              <th className={THR}>Millares / Rollos</th>
              <th className={THR}>Cajas / Paq.</th>
              <th className={THR}>Precio Unit USD</th>
              <th className={THR}>Total USD</th>
            </tr>
          </thead>
          <tbody>
            {data.ordenCompra.grupos.map((g) => (
              <GrupoOc key={g.categoria} g={g} />
            ))}
            <tr className="border-t-2 border-slate-400 bg-slate-100 font-bold">
              <td className={TD} colSpan={4}>
                TOTAL GENERAL
              </td>
              <td className={TDR}>{qty(c.ocTotales.cajas)}</td>
              <td className={TDR}>{data.ordenCompra.totalFurgonesTexto}</td>
              <td className={TDR}>{usd(c.ocTotales.usd)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2 space-y-0.5 text-[11px] text-slate-500">
        {data.ordenCompra.notas.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      <ParityFooter data={data} sheets={['OC']} />
    </SectionCard>
  );
}

function GrupoOc({ g }: { g: ReymaData['ordenCompra']['grupos'][number] }) {
  return (
    <>
      <tr className="bg-blue-50">
        <td className={`${TD} font-semibold text-blue-800`} colSpan={7}>
          {g.categoria}
        </td>
      </tr>
      {g.filas.map((f) => (
        <tr key={f.clave} className="border-t border-slate-100">
          <td className={TD}>{f.num}</td>
          <td className={`${TD} font-mono`}>{f.clave}</td>
          <td className={`${TD} max-w-[320px] truncate`} title={f.desc}>
            {f.desc}
          </td>
          <td className={TDR}>{qty(f.millares)}</td>
          <td className={TDR}>{qty(f.cajas)}</td>
          <td className={TDR}>{usd(f.precioUnit)}</td>
          <td className={TDR}>{usd(f.totalEsFormula ? f.cajas * f.precioUnit : f.totalUsd)}</td>
        </tr>
      ))}
      {g.subtotal ? (
        <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
          <td className={TD} colSpan={4}>
            SUBTOTAL {g.categoria}
          </td>
          <td className={TDR}>{qty(g.subtotal.cajas)}</td>
          <td className={TDR}>{g.subtotal.furgonesTexto}</td>
          <td className={TDR}>{usd(g.subtotal.totalUsd)}</td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- VENTAS

const MES_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function TabVentas({ data, c }: { data: ReymaData; c: Computed }) {
  return (
    <SectionCard title={data.ventas.titulo}>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH} colSpan={2}>
                Identificación
              </th>
              <th className="px-2 py-1 text-center font-semibold text-blue-700 border-l border-slate-200" colSpan={12}>
                Ventas 2024
              </th>
              <th className="px-2 py-1 text-center font-semibold text-blue-700 border-l border-slate-200" colSpan={12}>
                Ventas 2025
              </th>
              <th className="px-2 py-1 text-center font-semibold text-blue-700 border-l border-slate-200" colSpan={6}>
                Ventas 2026
              </th>
              <th className="px-2 py-1 text-center font-semibold text-purple-700 border-l border-slate-200" colSpan={9}>
                Indicadores + Pronóstico
              </th>
            </tr>
            <tr>
              <th className={TH}>Código</th>
              <th className={TH}>Clave</th>
              {MES_LABELS.map((m) => (
                <th key={`a${m}`} className={THR}>
                  {m}
                </th>
              ))}
              {MES_LABELS.map((m) => (
                <th key={`b${m}`} className={THR}>
                  {m}
                </th>
              ))}
              {data.ventas.meses2026.map((m) => (
                <th key={`c${m}`} className={THR}>
                  {m}
                </th>
              ))}
              <th className={`${THR} border-l border-slate-200`}>Total 26</th>
              <th className={THR}>Prom 24</th>
              <th className={THR}>Min</th>
              <th className={THR}>Max</th>
              <th className={THR}>Total 25</th>
              <th className={THR}>Total 24</th>
              <th className={THR}>Factor</th>
              <th className={THR}>Pron. Jul26</th>
              <th className={THR}>Pron. Ago26</th>
            </tr>
          </thead>
          <tbody>
            {data.ventas.rows.map((r) => {
              const d = c.ventasDer.get(r.cod) as VentasDerived;
              return (
                <tr key={r.cod} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className={`${TD} font-mono`}>{r.cod}</td>
                  <td className={TD} title={r.desc}>
                    {r.clave}
                  </td>
                  {r.v2024.map((v, i) => (
                    <td key={`a${i}`} className={TDR}>
                      {qty(v)}
                    </td>
                  ))}
                  {r.v2025.map((v, i) => (
                    <td key={`b${i}`} className={TDR}>
                      {qty(v)}
                    </td>
                  ))}
                  {r.v2026.map((v, i) => (
                    <td key={`c${i}`} className={TDR}>
                      {qty(v)}
                    </td>
                  ))}
                  <td className={`${TDR} border-l border-slate-200 font-medium`}>{qty(d.ai)}</td>
                  <td className={TDR}>{fmt(d.aj, 1)}</td>
                  <td className={TDR}>{qty(d.ak)}</td>
                  <td className={TDR}>{qty(d.al)}</td>
                  <td className={TDR}>{qty(d.am)}</td>
                  <td className={TDR}>{qty(d.an)}</td>
                  <td className={TDR}>{d.ao.toLocaleString('es-GT', { maximumFractionDigits: 3 })}</td>
                  <td className={`${TDR} font-medium text-purple-700`}>{fmt(d.ap, 1)}</td>
                  <td className={`${TDR} font-medium text-purple-700`}>{fmt(d.aq, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ParityFooter data={data} sheets={['VENTAS']} />
    </SectionCard>
  );
}

// ---------------------------------------------------------------- SALDOS

function TabSaldos({ data, c, asOf }: { data: ReymaData; c: Computed; asOf: Date }) {
  const furgones = data.saldos.furgones.filter((f) => f.estado !== null || f.fechaEmision !== null);
  const vacios = data.saldos.furgones.length - furgones.length;
  return (
    <SectionCard title={data.saldos.titulo}>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>Código</th>
              <th className={TH}>Descripción</th>
              <th className={THR}>Total Pedido</th>
              {furgones.map((f) => {
                const eta = parseFecha(f.eta);
                const rojo = eta !== null && eta <= asOf && estadoMatches(f.estado, 'transito');
                return (
                  <th
                    key={f.guia}
                    className={`px-1 py-1 text-center align-top font-normal ${rojo ? 'bg-red-100' : ''}`}
                    title={
                      `${f.guia} · emisión ${f.fechaEmision ?? '—'} · ETA ${f.eta ?? '—'} · ${f.etiqueta ?? ''}` +
                      (rojo ? ' · SEMÁFORO: ETA vencida y sigue EN TRÁNSITO' : '')
                    }
                  >
                    <div className="font-mono text-[10px] font-semibold">{f.guia.replace('-2026', '')}</div>
                    <div className="text-[9px] text-slate-500">{f.eta ?? ''}</div>
                    {estadoChip(f.estado)}
                    <div className="text-[9px] text-slate-500 max-w-[72px] truncate">{f.etiqueta}</div>
                  </th>
                );
              })}
              <th className={`${THR} border-l border-slate-300`}>Total Furg.</th>
              <th className={THR}>En Tránsito</th>
              <th className={THR}>Recibido</th>
              <th className={THR}>Ent. Directa</th>
              <th className={THR}>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {data.saldos.rows.map((r) => {
              const d = c.saldosDer.get(r.cod) as SaldosDerived;
              return (
                <tr key={r.cod} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className={`${TD} font-mono`}>{r.cod}</td>
                  <td className={`${TD} max-w-[220px] truncate`} title={r.desc}>
                    {r.desc}
                  </td>
                  <td className={`${TDR} font-medium`}>{qty(r.totalPedido)}</td>
                  {furgones.map((f) => (
                    <td key={f.guia} className={`${TDR} text-[11px]`}>
                      {r.cajas[f.guia] !== undefined && r.cajas[f.guia] !== 0 ? qty(r.cajas[f.guia]) : ''}
                    </td>
                  ))}
                  <td className={`${TDR} border-l border-slate-300 font-medium`}>{qty(d.ao)}</td>
                  <td className={TDR}>{qty(d.ap)}</td>
                  <td className={TDR}>{qty(d.aq)}</td>
                  <td className={TDR}>{qty(d.ar)}</td>
                  <td className={`${TDR} font-semibold ${d.as < 0 ? 'text-red-600' : ''}`}>{qty(d.as)}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
              <td className={TD} colSpan={2}>
                TOTAL GENERAL
              </td>
              <td className={TDR}>{qty(c.saldosTotal.totalPedido)}</td>
              {furgones.map((f) => (
                <td key={f.guia} className={`${TDR} text-[11px]`}>
                  {qty(c.saldosTotal.porGuia[f.guia])}
                </td>
              ))}
              <td className={`${TDR} border-l border-slate-300`}>{qty(c.saldosTotal.ao)}</td>
              <td className={TDR}>{qty(c.saldosTotal.ap)}</td>
              <td className={TDR}>{qty(c.saldosTotal.aq)}</td>
              <td className={TDR}>{qty(c.saldosTotal.ar)}</td>
              <td className={TDR} title="Como en el libro (AS53): suma solo los saldos positivos">
                {qty(c.saldosTotal.as)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">
        {vacios > 0 ? `${vacios} columnas de furgón vacías (G-205…G-209) no se muestran. ` : ''}
        Semáforo del libro (fila 54): «{data.saldos.semaforo}» — evaluado aquí contra la fecha de extracción (
        {asOf.toLocaleDateString('es-GT')}), no contra hoy: los datos no son en vivo.
      </div>
      <ParityFooter data={data} sheets={['SALDOS']} />
    </SectionCard>
  );
}

// ---------------------------------------------------------------- ENTREGAS

function TabEntregas({ data }: { data: ReymaData }) {
  return (
    <SectionCard title="ENTREGAS DIRECTAS — despachos de fábrica directo al cliente (sin precios de compra)">
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>Fecha</th>
              <th className={TH}>Factura</th>
              <th className={TH}>Guía</th>
              <th className={TH}>Cliente</th>
              <th className={TH}>Ciudad</th>
              <th className={TH}>PO</th>
              <th className={TH}>SO</th>
              <th className={TH}>Código</th>
              <th className={TH}>Descripción</th>
              <th className={THR}>Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {data.entregas.rows.map((r, i) => (
              <tr key={`${r.factura}-${r.cod}-${i}`} className="border-t border-slate-100 hover:bg-slate-50">
                <td className={TD}>{r.fecha}</td>
                <td className={`${TD} font-mono`}>{r.factura}</td>
                <td className={`${TD} font-mono`}>{r.guia}</td>
                <td className={TD}>{r.cliente}</td>
                <td className={TD}>{r.ciudad ?? <span className="text-slate-300">—</span>}</td>
                <td className={`${TD} font-mono text-[10px]`}>{r.po ?? ''}</td>
                <td className={`${TD} font-mono text-[10px]`}>{r.so ?? ''}</td>
                <td className={`${TD} font-mono`}>{r.cod}</td>
                <td className={`${TD} max-w-[280px] truncate`} title={r.desc}>
                  {r.desc}
                </td>
                <td className={TDR}>{qty(r.cantidad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">
        Registro sin fórmulas (se muestra tal cual el libro). Las filas de julio no traen Ciudad/PO/SO — ver Hallazgos.
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------- MRP

function TabMrp({ data, c }: { data: ReymaData; c: Computed }) {
  return (
    <SectionCard title={data.mrp.titulo}>
      <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded bg-slate-100 px-2 py-1">Capacidad furgón: {qty(data.mrp.capacidadM3)} m³</span>
        <span className="rounded bg-slate-100 px-2 py-1">Furgones de la semana: {c.mrp.totalFurgones}</span>
        <span className="rounded bg-slate-100 px-2 py-1">
          Furgones dedicados {data.mrp.codFurgonCompleto} (VT10): {c.mrp.furgonesDedicados}
        </span>
        <span className="rounded bg-amber-50 px-2 py-1 text-amber-800" title="Regla medida del libro — pendiente confirmar con Alexis (plan §8)">
          Inv. Disp. Bodega = San José + Patios − Pend. x Surtir (Petén/Zacapa/Z11 no cuentan)
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>#</th>
              <th className={TH}>Código</th>
              <th className={TH}>Clave</th>
              <th className={TH}>Descripción</th>
              <th className={THR}>Inv Disp Bodega</th>
              <th className={THR}>Tránsito</th>
              <th className={THR}>Inv Neto</th>
              <th className={THR}>Prom Mensual</th>
              <th className={THR}>Venta Sem.</th>
              <th className={THR}>Ped. Opt. Sem.</th>
              <th className={THR}>Nivel (sem)</th>
              <th className={TH}>Prioridad</th>
              <th className={THR}>Cajas a Desp.</th>
              <th className={THR}>Vol. Desp. m³</th>
              <th className={THR}>% Furgón</th>
              <th className={TH}>Furgón</th>
              <th className={TH}>Día</th>
            </tr>
          </thead>
          <tbody>
            {c.mrp.rows.map((d) => (
              <tr
                key={d.cod}
                className={`border-t border-slate-100 ${d.l < 2 ? 'bg-red-50' : 'hover:bg-slate-50'}`}
                title={d.l < 2 ? 'Resaltado como en el libro (formato condicional: nivel < 2 semanas)' : undefined}
              >
                <td className={TDR}>{d.a}</td>
                <td className={`${TD} font-mono`}>{d.cod}</td>
                <td className={TD}>{d.clave}</td>
                <td className={`${TD} max-w-[240px] truncate`} title={d.descProv}>
                  {d.descProv}
                </td>
                <td className={`${TDR} ${d.f < 0 ? 'text-red-600' : ''}`}>{qty(d.f)}</td>
                <td className={TDR}>{qty(d.g)}</td>
                <td className={`${TDR} font-medium ${d.h < 0 ? 'text-red-600' : ''}`}>{qty(d.h)}</td>
                <td className={TDR}>{qty(d.i)}</td>
                <td className={TDR}>{qty(d.j)}</td>
                <td className={`${TDR} font-semibold ${d.k > 0 ? 'text-blue-700' : 'text-slate-400'}`}>{qty(d.k)}</td>
                <td className={TDR}>{d.l === 999 ? '—' : d.l.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</td>
                <td className={TD}>{prioridadChip(d.o)}</td>
                <td className={TDR}>{d.w === null ? '' : qty(d.w)}</td>
                <td className={TDR}>{d.x === null ? '' : m3(d.x)}</td>
                <td className={TDR}>{d.y === null ? '' : pct(d.y)}</td>
                <td className={`${TD} font-medium`}>{d.aa ?? ''}</td>
                <td className={TD}>{d.ab ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">{data.mrp.leyenda}</div>
      <ParityFooter data={data} sheets={['MRP']} />
    </SectionCard>
  );
}

// ---------------------------------------------------------------- DESPACHOS

function TabDespachos({
  data,
  c,
  edits,
  setEdits,
}: {
  data: ReymaData;
  c: Computed;
  edits: Edits;
  setEdits: (e: Edits) => void;
}) {
  return (
    <>
      <SectionCard title={data.distribucion.titulo}>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse min-w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Furgón</th>
                <th className={TH}>Día de despacho</th>
                <th className={TH}>Contenido</th>
                <th className={THR}>Productos</th>
                <th className={THR}>Cajas</th>
                <th className={THR}>m³ cargados</th>
                <th className={THR}>% Ocup.</th>
                <th className={THR}>Espacio disp. m³</th>
              </tr>
            </thead>
            <tbody>
              {c.dayBlocks.map((b, i) => (
                <tr
                  key={b.etiqueta}
                  className={`border-t border-slate-100 ${b.totalPct < 0.6 ? 'bg-amber-50' : ''}`}
                  title={b.totalPct < 0.6 ? 'Resaltado como en el libro (formato condicional: ocupación < 60%)' : undefined}
                >
                  <td className={`${TD} font-semibold`}>{i + 1}</td>
                  <td className={TD}>{b.dia}</td>
                  <td className={`${TD} max-w-[320px] truncate`} title={b.contenido}>
                    {b.contenido}
                  </td>
                  <td className={TDR}>{b.conteoProductos}</td>
                  <td className={TDR}>{qty(b.totalCajas)}</td>
                  <td className={TDR}>{m3(b.totalM3)}</td>
                  <td className={`${TDR} ${b.totalPct > 1 ? 'text-red-600 font-semibold' : ''}`}>{pct(b.totalPct)}</td>
                  <td className={`${TDR} ${b.espacio < 0 ? 'text-red-600' : ''}`}>{m3(b.espacio)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
                <td className={TD} colSpan={3}>
                  TOTAL SEMANA
                </td>
                <td className={TDR}>{c.distribucion.total.productos}</td>
                <td className={TDR}>{qty(c.distribucion.total.cajas)}</td>
                <td className={TDR}>{m3(c.distribucion.total.m3)}</td>
                <td className={TDR}>{pct(c.distribucion.total.ocup)}</td>
                <td className={`${TDR} ${c.distribucion.total.espacio < 0 ? 'text-red-600' : ''}`}>
                  {m3(c.distribucion.total.espacio)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[11px] text-slate-500">{data.distribucion.nota}</div>
        <ParityFooter data={data} sheets={['DISTRIBUCION']} />
      </SectionCard>

      {data.daySheets.map((ds, dsi) => (
        <SectionCard key={ds.hoja} title={ds.titulo}>
          <div className="mb-2 text-[11px] text-slate-500">{ds.nota}</div>
          <div className="grid gap-4 lg:grid-cols-2">
            {ds.furgones.map((block, bi) => {
              const der = c.dayBlocks.find((b) => b.hoja === ds.hoja && b.etiqueta === block.etiqueta) as DayBlockDerived;
              return (
                <div key={block.etiqueta} className="rounded border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                    {block.titulo}
                  </div>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-slate-500">
                        <th className={TH}>Código</th>
                        <th className={TH}>Descripción</th>
                        <th className={THR}>Cajas</th>
                        <th className={THR}>m³/caja</th>
                        <th className={THR}>m³</th>
                        <th className={THR}>% furgón</th>
                      </tr>
                    </thead>
                    <tbody>
                      {der.filas.map((fl, fi) => {
                        const key = `${ds.hoja}|${bi}|${fi}`;
                        return (
                          <tr key={key} className="border-t border-slate-100">
                            <td className={`${TD} font-mono`}>
                              {fl.cod}
                              {fl.manual && (
                                <span className="ml-1 rounded bg-slate-200 px-1 text-[9px]" title="Fila agregada a mano en el libro (sin vínculo al MRP)">
                                  man
                                </span>
                              )}
                              {!fl.enTotalCajas && (
                                <span
                                  className="ml-1 rounded bg-amber-200 px-1 text-[9px] font-bold text-amber-900"
                                  title="El total de CAJAS del libro NO incluye esta fila (hallazgo F5) — se replica tal cual"
                                >
                                  ∉Σ
                                </span>
                              )}
                            </td>
                            <td className={`${TD} max-w-[200px] truncate`} title={fl.desc}>
                              {fl.desc}
                            </td>
                            <td className={TDR}>
                              <EditNum
                                value={fl.cajasEfectivas}
                                edited={fl.edited}
                                onChange={(v) => setEdits({ ...edits, cajas: { ...edits.cajas, [key]: v } })}
                                width="w-16"
                              />
                            </td>
                            <td className={TDR}>{fl.cubicaje.toLocaleString('es-GT', { maximumFractionDigits: 5 })}</td>
                            <td className={TDR}>{m3(fl.m3)}</td>
                            <td className={TDR}>{pct(fl.pct)}</td>
                          </tr>
                        );
                      })}
                      <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                        <td className={TD} colSpan={2}>
                          TOTAL {block.etiqueta}
                        </td>
                        <td className={TDR}>{qty(der.totalCajas)}</td>
                        <td />
                        <td className={TDR}>{m3(der.totalM3)}</td>
                        <td className={`${TDR} ${der.totalPct > 1 ? 'text-red-600' : ''}`}>{pct(der.totalPct)}</td>
                      </tr>
                      <tr className="bg-slate-50 text-slate-600">
                        <td className={TD} colSpan={2}>
                          Espacio disponible
                        </td>
                        <td />
                        <td />
                        <td className={`${TDR} ${der.espacio < 0 ? 'text-red-600' : ''}`}>{m3(der.espacio)}</td>
                        <td className={TDR}>{pct(der.espacioPct)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          {dsi === data.daySheets.length - 1 ? (
            <ParityFooter data={data} sheets={data.daySheets.map((d) => d.hoja)} />
          ) : null}
        </SectionCard>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- ALERTAS

function TabAlertas({ data }: { data: ReymaData }) {
  return (
    <SectionCard title={data.alertas.titulo}>
      <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        Instantánea estática del libro (hoja sin fórmulas, generada en una corrida anterior — no cuadra con el MRP
        vigente). Se muestra tal cual; en la fase 2 estas alertas se calcularán en vivo.
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>#</th>
              <th className={TH}>Código</th>
              <th className={TH}>Clave</th>
              <th className={TH}>Descripción</th>
              <th className={THR}>Nivel (sem)</th>
              <th className={THR}>Ped. Opt.</th>
              <th className={THR}>Progr.</th>
              <th className={THR}>Faltante</th>
              <th className={TH}>Alerta</th>
            </tr>
          </thead>
          <tbody>
            {data.alertas.rows.map((r, i) => (
              <tr key={r.cod} className={`border-t border-slate-100 ${r.alerta.startsWith('CRITICO') ? 'bg-red-50' : ''}`}>
                <td className={TDR}>{i + 1}</td>
                <td className={`${TD} font-mono`}>{r.cod}</td>
                <td className={TD}>{r.clave}</td>
                <td className={`${TD} max-w-[260px] truncate`} title={r.desc}>
                  {r.desc}
                </td>
                <td className={TDR}>{r.nivel.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</td>
                <td className={TDR}>{qty(r.pedOpt)}</td>
                <td className={TDR}>{qty(r.progr)}</td>
                <td className={`${TDR} ${r.faltante > 0 ? 'font-semibold text-red-600' : ''}`}>{qty(r.faltante)}</td>
                <td className={`${TD} text-[11px]`}>{r.alerta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------- NC

function TabNc({
  data,
  c,
  edits,
  setEdits,
}: {
  data: ReymaData;
  c: Computed;
  edits: Edits;
  setEdits: (e: Edits) => void;
}) {
  const tarifa = edits.tarifaNc ?? data.ncJul.tarifa;
  return (
    <>
      <SectionCard title={data.ncJul.titulo}>
        <div className="mb-2 text-[11px] text-slate-500">{data.ncJul.sub}</div>
        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="font-medium text-slate-600">Tarifa USD/caja:</span>
          <EditNum
            value={tarifa}
            edited={edits.tarifaNc !== null}
            onChange={(v) => setEdits({ ...edits, tarifaNc: v })}
            width="w-16"
          />
          <span className="text-[11px] text-slate-500">
            editable como pidió Alexis («que uno pueda editarlo y cambiarlo… te cambia todo»)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse min-w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Facturas / Furgones</th>
                <th className={TH}>Emisión</th>
                <th className={TH}>Recepción</th>
                <th className={TH}>Clave</th>
                <th className={TH}>Descripción</th>
                <th className={THR}>Cajas recibidas</th>
                <th className={THR}>USD/caja</th>
                <th className={THR}>NC USD</th>
              </tr>
            </thead>
            <tbody>
              {c.ncJul.rows.map((r) => (
                <tr key={r.clave} className="border-t border-slate-100">
                  <td className={`${TD} font-mono text-[10px]`}>{r.facturas ?? ''}</td>
                  <td className={TD}>{r.fechaEmision ?? ''}</td>
                  <td className={TD}>{r.fechaRecepcion ?? ''}</td>
                  <td className={`${TD} font-mono`}>{r.clave}</td>
                  <td className={`${TD} max-w-[260px] truncate`} title={r.desc}>
                    {r.desc}
                  </td>
                  <td className={TDR}>{qty(r.cajas)}</td>
                  <td className={TDR}>{r.tarifaEfectiva.toLocaleString('es-GT', { maximumFractionDigits: 4 })}</td>
                  <td className={`${TDR} font-medium`}>{usd(r.nc)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
                <td className={TD} colSpan={5}>
                  TOTAL NOTA DE CRÉDITO JULIO 2026
                </td>
                <td className={TDR}>{qty(c.ncJul.totalCajas)}</td>
                <td />
                <td className={TDR}>{usd(c.ncJul.totalNc)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[11px] text-slate-500">{data.ncJul.instruccion}</div>
        <ParityFooter data={data} sheets={['NC-JUL']} />
      </SectionCard>

      <SectionCard title={data.ncJun.titulo}>
        <div className="mb-2 text-[11px] text-slate-500">
          {data.ncJun.sub} — hoja histórica sin fórmulas; se muestra tal cual el libro.
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse min-w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Furgón</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Fecha factura</th>
                <th className={TH}>Descripción</th>
                <th className={THR}>Cajas</th>
                <th className={THR}>P. Factura</th>
                <th className={THR}>P. Neto</th>
                <th className={THR}>Subtotal USD</th>
                <th className={THR}>NC USD</th>
              </tr>
            </thead>
            <tbody>
              {data.ncJun.detalle.map((r, i) => (
                <tr key={`${r.furgon}-${i}`} className="border-t border-slate-100">
                  <td className={`${TD} font-mono`}>{r.furgon}</td>
                  <td className={TD}>{estadoChip(r.estado)}</td>
                  <td className={TD}>{r.fecha}</td>
                  <td className={`${TD} max-w-[280px] truncate`} title={r.desc}>
                    {r.desc}
                  </td>
                  <td className={TDR}>{qty(r.cajas)}</td>
                  <td className={TDR}>{usd(r.pFactura)}</td>
                  <td className={TDR}>{usd(r.pNeto)}</td>
                  <td className={TDR}>{usd(r.subtotal)}</td>
                  <td className={TDR}>{usd(r.nc)}</td>
                </tr>
              ))}
              {data.ncJun.totales ? (
                <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
                  <td className={TD} colSpan={4}>
                    {data.ncJun.totales.etiqueta}
                  </td>
                  <td className={TDR}>{qty(data.ncJun.totales.cajas)}</td>
                  <td />
                  <td className={TDR}>{usd(data.ncJun.totales.pNeto)}</td>
                  <td className={TDR}>{usd(data.ncJun.totales.subtotal)}</td>
                  <td className={TDR}>{usd(data.ncJun.totales.nc)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <h4 className="mt-4 mb-1 text-xs font-semibold text-slate-600">Resumen por producto</h4>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Clave</th>
                <th className={TH}>Descripción</th>
                <th className={THR}>Total cajas</th>
                <th className={THR}>NC/caja</th>
                <th className={THR}>NC total USD</th>
              </tr>
            </thead>
            <tbody>
              {data.ncJun.resumen.map((r) => (
                <tr key={r.clave} className="border-t border-slate-100">
                  <td className={`${TD} font-mono`}>{r.clave}</td>
                  <td className={`${TD} max-w-[300px] truncate`} title={r.desc}>
                    {r.desc}
                  </td>
                  <td className={TDR}>{qty(r.cajas)}</td>
                  <td className={TDR}>{r.tarifa.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</td>
                  <td className={TDR}>{usd(r.nc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  );
}

// ---------------------------------------------------------------- DASHBOARD

function TabDashboard({ data, c }: { data: ReymaData; c: Computed }) {
  const rows = [...c.dashboard.categorias, c.dashboard.total];
  return (
    <SectionCard title={data.dashboard.titulo}>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>Categoría</th>
              <th className={THR}>Total Pedido</th>
              <th className={THR}>En Furgones</th>
              <th className={THR}>Recibido</th>
              <th className={THR}>En Tránsito</th>
              <th className={THR}>Entrega Directa</th>
              <th className={THR}>Saldo</th>
              <th className={TH}>Fill Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.nombre}
                className={`border-t border-slate-100 ${r.nombre === 'TOTAL GENERAL' ? 'bg-slate-100 font-semibold' : ''}`}
              >
                <td className={TD}>{r.nombre}</td>
                <td className={TDR}>{qty(r.b)}</td>
                <td className={TDR}>{qty(r.c)}</td>
                <td className={TDR}>{qty(r.d)}</td>
                <td className={TDR}>{qty(r.e)}</td>
                <td className={TDR}>{qty(r.f)}</td>
                <td className={`${TDR} ${r.g < 0 ? 'text-red-600' : ''}`}>{qty(r.g)}</td>
                <td className={`${TD} min-w-[140px]`}>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 overflow-hidden rounded bg-slate-200">
                      <div
                        className={`h-full ${r.h >= 1 ? 'bg-emerald-500' : r.h >= 0.8 ? 'bg-blue-500' : 'bg-amber-500'}`}
                        style={{ width: `${Math.min(100, r.h * 100)}%` }}
                      />
                    </div>
                    <span className="tabular-nums">{pct(r.h)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Como en el libro, los bloques por categoría omiten los productos agregados tarde a SALDOS (hallazgo F3):
          el TOTAL de aquí no cuadra con el total de SALDOS. Se replica tal cual.
        </span>
      </div>
      <div className="mt-2 space-y-0.5 text-[11px] text-slate-500">
        {data.dashboard.notas.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      <ParityFooter data={data} sheets={['DASHBOARD']} />
    </SectionCard>
  );
}

// ---------------------------------------------------------------- BD

function TabBd({ data }: { data: ReymaData }) {
  const byCod = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const r of data.bd.reymaSlice) {
      const cur = m.get(r.cod) ?? {};
      cur[r.bodega] = r.existencias;
      m.set(r.cod, cur);
    }
    return m;
  }, [data.bd.reymaSlice]);
  const stats = data.bd.stats as Record<string, number | string[]>;
  return (
    <SectionCard title="BD_INVENTARIOS — volcado crudo de Odoo (staging del libro)">
      <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded bg-slate-100 px-2 py-1">{fmt(Number(stats.filas))} filas</span>
        <span className="rounded bg-slate-100 px-2 py-1">{fmt(Number(stats.codigos))} códigos</span>
        <span className="rounded bg-slate-100 px-2 py-1">bodegas: {(stats.bodegas as string[]).join(', ')}</span>
        <span className="rounded bg-red-50 px-2 py-1 text-red-700">
          {fmt(Number(stats.descDesalineadas))}/{fmt(Number(stats.descConCodigo))} descripciones desalineadas del código (F6)
        </span>
        <span className="rounded bg-red-50 px-2 py-1 text-red-700">
          {fmt(Number(stats.diffsVsModelo))} celdas difieren del MODELO (F6)
        </span>
      </div>
      <div className="mb-2 text-[11px] text-slate-500">{data.bd.nota}</div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>Código</th>
              <th className={THR}>SJ</th>
              <th className={THR}>Z11</th>
              <th className={THR}>PET</th>
              <th className={THR}>ZAC</th>
              <th className={THR}>PAT</th>
              <th className={THR}>PSX</th>
            </tr>
          </thead>
          <tbody>
            {[...byCod.entries()].map(([cod, b]) => (
              <tr key={cod} className="border-t border-slate-100">
                <td className={`${TD} font-mono`}>{cod}</td>
                {['SJ', 'Z11', 'PET', 'ZAC', 'PAT', 'PSX'].map((k) => (
                  <td key={k} className={TDR}>
                    {b[k] !== undefined ? qty(b[k]) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------- JUNIO (legacy)

function TabJunio({ data }: { data: ReymaData }) {
  return (
    <SectionCard title={data.saldosJunio.titulo}>
      <div className="mb-2 rounded border border-slate-300 bg-slate-100 px-3 py-2 text-[11px] text-slate-600">
        Hoja HISTÓRICA del pedido de junio. Alexis pidió eliminarla («esa fue de junio… si quiere la eliminas»); se
        conserva aquí solo como referencia, con los valores del libro sin recálculo.
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>Código</th>
              <th className={TH}>Descripción</th>
              <th className={THR}>Total Pedido</th>
              {data.saldosJunio.furgones.map((f) => (
                <th key={f.guia} className="px-1 py-1 text-center align-top font-normal" title={`${f.guia} · ${f.etiqueta ?? ''}`}>
                  <div className="font-mono text-[10px] font-semibold">{f.guia.replace('-2026', '')}</div>
                  {estadoChip(f.estado)}
                </th>
              ))}
              <th className={`${THR} border-l border-slate-300`}>Total</th>
              <th className={THR}>Tránsito</th>
              <th className={THR}>Recibido</th>
              <th className={THR}>Ent. Dir.</th>
              <th className={THR}>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {data.saldosJunio.rows.map((r) => (
              <tr key={r.cod} className="border-t border-slate-100">
                <td className={`${TD} font-mono`}>{r.cod}</td>
                <td className={`${TD} max-w-[220px] truncate`} title={r.desc}>
                  {r.desc}
                </td>
                <td className={TDR}>{qty(r.totalPedido)}</td>
                {data.saldosJunio.furgones.map((f) => (
                  <td key={f.guia} className={`${TDR} text-[11px]`}>
                    {r.cajas[f.guia] !== undefined && r.cajas[f.guia] !== 0 ? qty(r.cajas[f.guia]) : ''}
                  </td>
                ))}
                <td className={`${TDR} border-l border-slate-300`}>{qty(r.cached.total)}</td>
                <td className={TDR}>{qty(r.cached.transito)}</td>
                <td className={TDR}>{qty(r.cached.recibido)}</td>
                <td className={TDR}>{qty(r.cached.entrega)}</td>
                <td className={`${TDR} ${r.cached.saldo < 0 ? 'text-red-600' : ''}`}>{qty(r.cached.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------- HALLAZGOS

function TabHallazgos({ data }: { data: ReymaData }) {
  const warns = data.findings.filter((f) => f.severity === 'warn');
  const infos = data.findings.filter((f) => f.severity === 'info');
  return (
    <SectionCard title="Hallazgos del libro — inconsistencias internas, replicadas tal cual (nunca corregidas en silencio)">
      <p className="mb-3 text-[11px] text-slate-500">
        Cada hallazgo viene de la extracción medida del archivo (script {data.provenance.script}, v
        {data.provenance.scriptVersion}). Corregirlos aquí rompería la paridad con los números de Alexis; son la
        agenda de preguntas para la fase 2.
      </p>
      {[
        { titulo: 'Advertencias', items: warns, Icon: AlertTriangle, cls: 'border-amber-200 bg-amber-50 text-amber-900' },
        { titulo: 'Informativos', items: infos, Icon: Info, cls: 'border-slate-200 bg-slate-50 text-slate-700' },
      ].map(({ titulo, items, Icon, cls }) => (
        <div key={titulo} className="mb-4">
          <h4 className="mb-2 text-xs font-semibold text-slate-600">
            {titulo} ({items.length})
          </h4>
          <div className="space-y-1.5">
            {items.map((f, i) => (
              <div key={`${f.id}-${i}`} className={`flex items-start gap-2 rounded border px-3 py-1.5 text-[11px] ${cls}`}>
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <span className="font-mono font-semibold">{f.id}</span>{' '}
                  <span className="text-[10px] opacity-70">
                    [{f.sheet} · {f.cell}]
                  </span>{' '}
                  {f.message}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </SectionCard>
  );
}
