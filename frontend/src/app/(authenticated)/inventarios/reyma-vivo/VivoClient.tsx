'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Info, RotateCcw } from 'lucide-react';
import {
  computeMrp,
  modeloDerived,
  ventasDerived,
  fmt,
  type MrpDerived,
  type ReymaData,
  type VentasRow,
} from '../reyma/engine';
import type { ReymaVivoPayload, VivoRow } from './types';

// ---------------------------------------------------------------- helpers

const TH = 'px-2 py-1.5 text-left font-semibold text-slate-600 whitespace-nowrap';
const THR = 'px-2 py-1.5 text-right font-semibold text-slate-600 whitespace-nowrap';
const TD = 'px-2 py-1 whitespace-nowrap';
const TDR = 'px-2 py-1 text-right whitespace-nowrap tabular-nums';

function qty(n: number): string {
  return Number.isInteger(n) ? fmt(n) : fmt(n, 2);
}
function m3(n: number): string {
  return fmt(n, 2);
}

function prioridadChip(o: string) {
  const cls = o.startsWith('CRITICO')
    ? 'bg-red-100 text-red-700'
    : o.startsWith('PRECAUCION')
      ? 'bg-amber-100 text-amber-700'
      : 'bg-emerald-100 text-emerald-700';
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{o}</span>;
}

const TABS = [
  { id: 'modelo', label: 'Modelo (pedido mensual)' },
  { id: 'mrp', label: 'MRP semanal' },
  { id: 'ventas', label: 'Ventas' },
  { id: 'datos', label: 'Datos y sincronización' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// ---------------------------------------------------------------- component

export function VivoClient() {
  const [payload, setPayload] = useState<ReymaVivoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('modelo');
  const [proyEdits, setProyEdits] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    fetch('/api/inventarios/reyma')
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        if (alive) setPayload(body as ReymaVivoPayload);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const computed = useMemo(() => {
    if (!payload) return null;
    const ventasByCod = new Map<string, VentasRow>(payload.ventas.map((v) => [v.cod, v]));
    const modeloByCod = new Map(payload.rows.map((r) => [r.cod, r]));
    const der = payload.rows.map((r) => ({
      row: r,
      d: modeloDerived(r, ventasByCod, proyEdits[r.cod]),
    }));
    // MRP through the SAME engine: no furgón assignments yet (bin-packing = L3),
    // so W/X compute and furgón/día stay null. Type assertion documented: computeMrp
    // only touches data.mrp.* of ReymaData.
    const mrpData = {
      mrp: {
        titulo: '',
        leyenda: '',
        capacidadM3: payload.config.capacidadM3,
        codFurgonCompleto: payload.config.codFurgonCompleto,
        rows: payload.rows.map((r) => ({
          cod: r.cod,
          furgon: null,
          inZ2Range: true,
          inDespacho: true,
        })),
        furgonDias: [],
      },
    } as unknown as ReymaData;
    const mrp = computeMrp(mrpData, modeloByCod, ventasByCod, proyEdits);
    const mrpSorted = [...mrp.rows].sort((a, b) => a.l - b.l);
    const totCajas = der.reduce((a, x) => a + x.d.u, 0);
    const totM3 = der.reduce((a, x) => a + x.d.v, 0);
    const criticos = mrp.rows.filter((r) => r.l < 2).length;
    return { ventasByCod, der, mrpSorted, totCajas, totM3, criticos };
  }, [payload, proyEdits]);

  if (error) {
    return (
      <div className="p-6 max-w-[900px] mx-auto">
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mr-1 inline h-4 w-4" /> {error}
        </div>
      </div>
    );
  }
  if (!payload || !computed) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-slate-500">
        <Activity className="h-4 w-4 animate-pulse" /> Cargando datos en vivo…
      </div>
    );
  }

  const syncDate = payload.sync.finishedAt
    ? new Date(payload.sync.finishedAt).toLocaleString('es-GT')
    : '—';
  const nEdits = Object.keys(proyEdits).length;
  const catFallback = payload.rows.filter((r) => r.categoriaEsFallback).length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Modelo Reyma — EN VIVO</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            <Activity className="h-3 w-3" /> Odoo producción
          </span>
          {nEdits > 0 && (
            <button
              onClick={() => setProyEdits({})}
              className="inline-flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              <RotateCcw className="h-3 w-3" /> Restaurar proyecciones ({nEdits})
            </button>
          )}
        </div>
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          Última sincronización: <strong>{syncDate}</strong> (corrida{' '}
          <span className="font-mono">{payload.sync.id.slice(0, 8)}</span>). Mismo motor de cálculo que la réplica
          (paridad 2,752/2,752 con el libro de Alexis). Proyección por defecto = promedio móvil de{' '}
          {payload.config.mesesPromedioMovil} meses completos, editable; pendientes por surtir cuentan solo con edad ≤{' '}
          {payload.config.maxEdadPendientesDias} días; tránsito = facturado no recibido (entregas directas aparte).
          Las ediciones son locales — la persistencia llega en L3.
          {catFallback > 0 && (
            <>
              {' '}
              <span className="font-semibold">{catFallback} categorías aún vienen del Excel</span> (carga en Odoo
              pendiente — David).
            </>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Productos en alcance', value: fmt(payload.rows.length) },
          { label: 'Pedido óptimo total (cajas)', value: fmt(computed.totCajas) },
          {
            label: 'Volumen pedido (m³ / furgones)',
            value: `${m3(computed.totM3)} / ${fmt(Math.ceil(computed.totM3 / payload.config.capacidadM3))}`,
          },
          { label: 'Críticos (< 2 semanas)', value: fmt(computed.criticos) },
        ].map((k) => (
          <div key={k.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="text-[11px] text-slate-500">{k.label}</div>
            <div className="text-lg font-bold text-slate-800 tabular-nums">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 -mb-px ${
              tab === t.id
                ? 'border-emerald-600 text-emerald-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'modelo' && (
        <TabModelo payload={payload} computed={computed} proyEdits={proyEdits} setProyEdits={setProyEdits} />
      )}
      {tab === 'mrp' && <TabMrp mrpSorted={computed.mrpSorted} />}
      {tab === 'ventas' && <TabVentas payload={payload} computed={computed} />}
      {tab === 'datos' && <TabDatos payload={payload} />}
    </div>
  );
}

interface Computed {
  ventasByCod: Map<string, VentasRow>;
  der: Array<{ row: VivoRow; d: ReturnType<typeof modeloDerived> }>;
  mrpSorted: MrpDerived[];
  totCajas: number;
  totM3: number;
  criticos: number;
}

// ---------------------------------------------------------------- tabs

function TabModelo({
  payload,
  computed,
  proyEdits,
  setProyEdits,
}: {
  payload: ReymaVivoPayload;
  computed: Computed;
  proyEdits: Record<string, number>;
  setProyEdits: (e: Record<string, number>) => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>Código</th>
              <th className={TH}>Clave</th>
              <th className={TH}>Descripción</th>
              <th className={TH}>Categoría</th>
              <th className={THR}>San José</th>
              <th className={THR}>Zona 11</th>
              <th className={THR}>Petén</th>
              <th className={THR}>Zacapa</th>
              <th className={THR}>Patios</th>
              <th className={THR}>PxS (≤8d)</th>
              <th className={THR}>Inv. Disp.</th>
              <th className={THR}>Tránsito</th>
              <th className={THR}>Ent. Directa</th>
              <th className={THR}>Proyección</th>
              <th className={THR}>Stock Seg.</th>
              <th className={THR}>Pedido Óptimo</th>
              <th className={THR}>Vol. m³</th>
            </tr>
          </thead>
          <tbody>
            {computed.der.map(({ row: r, d }) => (
              <tr key={r.cod} className="border-t border-slate-100 hover:bg-slate-50">
                <td className={`${TD} font-mono`}>{r.cod}</td>
                <td className={TD}>{r.clave}</td>
                <td className={`${TD} max-w-[240px] truncate`} title={r.prodReyma}>
                  {r.desc || r.prodReyma}
                </td>
                <td className={TD}>
                  {r.cat}
                  {r.categoriaEsFallback && (
                    <span className="ml-1 rounded bg-slate-200 px-1 text-[9px]" title="Categoría del Excel — carga en Odoo pendiente (P7)">
                      xlsx
                    </span>
                  )}
                </td>
                <td className={TDR}>{qty(r.sj)}</td>
                <td className={TDR}>{qty(r.z11)}</td>
                <td className={TDR}>{qty(r.pet)}</td>
                <td className={TDR}>{qty(r.zac)}</td>
                <td className={TDR}>{qty(r.pat)}</td>
                <td className={TDR} title={`Total sin filtro de edad: ${qty(r.psxTotal)}`}>
                  {qty(r.psx)}
                </td>
                <td className={`${TDR} font-medium ${d.n < 0 ? 'text-red-600' : ''}`}>{qty(d.n)}</td>
                <td className={TDR}>{qty(r.transito)}</td>
                <td className={TDR}>{r.entregaDirecta ? qty(r.entregaDirecta) : ''}</td>
                <td className={TDR}>
                  <input
                    type="number"
                    step="any"
                    value={proyEdits[r.cod] ?? r.proyeccion}
                    onChange={(e) =>
                      setProyEdits({ ...proyEdits, [r.cod]: Number(e.target.value) || 0 })
                    }
                    className={`w-20 rounded border px-1 py-0.5 text-right text-xs tabular-nums bg-yellow-50 focus:outline-none focus:ring-1 focus:ring-emerald-400 ${
                      proyEdits[r.cod] !== undefined ? 'border-amber-500 ring-1 ring-amber-400' : 'border-yellow-300'
                    }`}
                    title={
                      proyEdits[r.cod] !== undefined
                        ? 'Editado (no guardado — persistencia en L3)'
                        : `Promedio móvil ${payload.config.mesesPromedioMovil} meses — editable ("yo corrijo")`
                    }
                  />
                </td>
                <td className={TDR}>{qty(d.r)}</td>
                <td className={`${TDR} font-semibold ${d.u > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{qty(d.u)}</td>
                <td className={TDR}>{m3(d.v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabMrp({ mrpSorted }: { mrpSorted: MrpDerived[] }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="mb-2 text-[11px] text-slate-500">
        Ordenado por nivel de inventario (menor cobertura = mayor prioridad). Inv. Disp. Bodega = San José + Patios −
        PxS (regla confirmada por Alexis). La asignación de furgones/días (bin-packing) llega en L3.
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
              <th className={THR}>Vol. m³</th>
            </tr>
          </thead>
          <tbody>
            {mrpSorted.map((d, i) => (
              <tr
                key={d.cod}
                className={`border-t border-slate-100 ${d.l < 2 ? 'bg-red-50' : 'hover:bg-slate-50'}`}
              >
                <td className={TDR}>{i + 1}</td>
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
                <td className={`${TDR} font-semibold ${d.k > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{qty(d.k)}</td>
                <td className={TDR}>{d.l === 999 ? '—' : d.l.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</td>
                <td className={TD}>{prioridadChip(d.o)}</td>
                <td className={TDR}>{d.w === null ? '' : qty(d.w)}</td>
                <td className={TDR}>{d.x === null ? '' : m3(d.x)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const MES_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function TabVentas({ payload, computed }: { payload: ReymaVivoPayload; computed: Computed }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="mb-2 text-[11px] text-slate-500">
        Fuente: entregado (qty_delivered) de Odoo desde oct-2024; historial SAE (sales.history) antes. 2024 ene–sep
        proviene del SAE. El mes en curso es parcial.
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>Código</th>
              <th className={TH}>Clave</th>
              {[2024, 2025, 2026].map((y) => (
                <th key={y} className="px-2 py-1 text-center font-semibold text-emerald-700 border-l border-slate-200" colSpan={y === 2026 ? (payload.ventas[0]?.v2026.length ?? 0) : 12}>
                  {y}
                </th>
              ))}
              <th className={`${THR} border-l border-slate-200`}>Factor</th>
              <th className={THR}>Pron. mes act.</th>
              <th className={THR}>Pron. mes sig.</th>
            </tr>
            <tr>
              <th className={TH} colSpan={2} />
              {MES_LABELS.map((m) => (
                <th key={`a${m}`} className={THR}>{m}</th>
              ))}
              {MES_LABELS.map((m) => (
                <th key={`b${m}`} className={THR}>{m}</th>
              ))}
              {MES_LABELS.slice(0, payload.ventas[0]?.v2026.length ?? 0).map((m) => (
                <th key={`c${m}`} className={THR}>{m}</th>
              ))}
              <th colSpan={3} />
            </tr>
          </thead>
          <tbody>
            {payload.ventas.map((v) => {
              const d = ventasDerived(v);
              return (
                <tr key={v.cod} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className={`${TD} font-mono`}>{v.cod}</td>
                  <td className={TD} title={v.desc}>{v.clave}</td>
                  {v.v2024.map((x, i) => (
                    <td key={`a${i}`} className={TDR}>{x ? qty(x) : ''}</td>
                  ))}
                  {v.v2025.map((x, i) => (
                    <td key={`b${i}`} className={TDR}>{x ? qty(x) : ''}</td>
                  ))}
                  {v.v2026.map((x, i) => (
                    <td key={`c${i}`} className={TDR}>{x ? qty(x) : ''}</td>
                  ))}
                  <td className={`${TDR} border-l border-slate-200`}>
                    {d.ao.toLocaleString('es-GT', { maximumFractionDigits: 3 })}
                  </td>
                  <td className={`${TDR} text-emerald-700`}>{fmt(d.ap, 1)}</td>
                  <td className={`${TDR} text-emerald-700`}>{fmt(d.aq, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">
        {computed.der.length} productos · pronósticos = mes año anterior × factor de crecimiento (fórmula del libro).
      </div>
    </div>
  );
}

function TabDatos({ payload }: { payload: ReymaVivoPayload }) {
  const directas = payload.transitoDetalle.filter((t) => t.esEntregaDirecta);
  return (
    <>
      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          Tránsito en detalle — facturado no recibido ({payload.transitoDetalle.length} líneas,{' '}
          {directas.length} de entrega directa)
        </h3>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse min-w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>PO</th>
                <th className={TH}>Código</th>
                <th className={THR}>Cajas</th>
                <th className={TH}>Destino</th>
                <th className={TH}>Fecha plan</th>
                <th className={TH}>Tipo</th>
              </tr>
            </thead>
            <tbody>
              {payload.transitoDetalle.map((t, i) => (
                <tr key={`${t.poName}-${t.codigo}-${i}`} className="border-t border-slate-100">
                  <td className={`${TD} font-mono text-[10px] max-w-[280px] truncate`} title={t.poName}>
                    {t.poName}
                  </td>
                  <td className={`${TD} font-mono`}>{t.codigo}</td>
                  <td className={TDR}>{qty(t.cantidad)}</td>
                  <td className={TD}>{t.destino ?? '—'}</td>
                  <td className={TD}>
                    {t.fechaPlaneada ?? '—'}
                    {t.esFechaPasada && (
                      <span className="ml-1 rounded bg-slate-200 px-1 text-[9px]" title="Fecha de PO no mantenida en Reyma — informativo">
                        pasada
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    {t.esEntregaDirecta ? (
                      <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                        ENTREGA DIRECTA
                      </span>
                    ) : (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        A BODEGA
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {payload.transitoDetalle.length === 0 && (
                <tr>
                  <td className={TD} colSpan={6}>
                    Sin tránsito facturado pendiente de recibir.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          Sincronización {payload.sync.id.slice(0, 8)} — conteos {JSON.stringify(payload.sync.counts)}
        </h3>
        <div className="space-y-1.5">
          {payload.issues.map((f, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded border px-3 py-1.5 text-[11px] ${
                f.severity === 'info'
                  ? 'border-slate-200 bg-slate-50 text-slate-700'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              {f.severity === 'info' ? (
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <div>
                <span className="font-mono text-[10px] opacity-70">[{f.entity ?? '—'}]</span> {f.message}
              </div>
            </div>
          ))}
          {payload.issues.length === 0 && (
            <div className="text-[11px] text-slate-500">Sin observaciones en esta corrida.</div>
          )}
        </div>
      </div>
    </>
  );
}
