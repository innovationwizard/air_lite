'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Info, RotateCcw, Save, Truck, X } from 'lucide-react';
import {
  computeMrp,
  modeloDerived,
  ventasDerived,
  fmt,
  xround,
  type MrpDerived,
  type ReymaData,
  type VentasRow,
} from '../reyma/engine';
import {
  generarPlan,
  mrpRegional,
  DIAS_DEFAULT,
  OBJETIVO_SEMANAS_REGIONAL_DEFAULT,
  type PlanFurgon,
} from './planificacion';
import type { EnlaceFactura, ReymaVivoPayload, VivoRow } from './types';
import { computeSaldos } from './saldos';
import { conciliar, type Enlace, type Excepcion } from './conciliacion';
import { diasHabilesDe, resolverEta } from './eta';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Documento externo imprimible (C5/C6): ventana limpia + print — "un PDF o algo externo" (Alexis). */
function abrirImpresion(titulo: string, cuerpo: string): string | null {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return 'Ventana de impresión bloqueada — permitir popups';
  w.document.write(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>${esc(titulo)}</title>` +
      '<style>body{font-family:Arial,Helvetica,sans-serif;font-size:12px;margin:24px;color:#111}' +
      'h1{font-size:16px;margin:0 0 4px}h2{font-size:13px;margin:16px 0 6px}' +
      'table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #999;padding:3px 6px;text-align:left}' +
      'td.n,th.n{text-align:right}tr.sub td{font-weight:bold;background:#f0f0f0}' +
      '.meta{color:#555;font-size:11px;margin-bottom:12px}' +
      '.nota{margin-top:14px;font-size:11px;color:#333;border-top:1px solid #ccc;padding-top:8px}</style>' +
      `</head><body>${cuerpo}<script>window.onload=function(){window.print()}</` +
      'script></body></html>',
  );
  w.document.close();
  return null;
}

async function postJson(path: string, body: unknown): Promise<string | null> {
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      return j.error ?? `HTTP ${r.status}`;
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'error de red';
  }
}

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
  { id: 'modelo', label: 'Modelo' },
  { id: 'pedido', label: 'Pedido mensual' },
  { id: 'mrp', label: 'MRP + Plan de despacho' },
  { id: 'nc', label: 'NC Duroport y precios' },
  { id: 'cumplimiento', label: 'Cumplimiento' },
  { id: 'ventas', label: 'Ventas' },
  { id: 'datos', label: 'Datos y sincronización' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// ---------------------------------------------------------------- component

export function VivoClient() {
  const [payload, setPayload] = useState<ReymaVivoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('modelo');
  const [proyEdits, setProyEdits] = useState<Record<string, number>>({});

  const load = useCallback(() => {
    fetch('/api/inventarios/reyma')
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        setPayload(body as ReymaVivoPayload);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = useCallback((msg: string) => {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(null), 4000);
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

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Modelo Reyma — EN VIVO</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            <Activity className="h-3 w-3" /> Odoo producción
          </span>
          {nEdits > 0 && (
            <>
              <button
                onClick={async () => {
                  const errs: string[] = [];
                  for (const [codigo, cajas] of Object.entries(proyEdits)) {
                    const e = await postJson('/api/inventarios/reyma/proyeccion', { codigo, cajas });
                    if (e) errs.push(`${codigo}: ${e}`);
                  }
                  setProyEdits({});
                  load();
                  flash(errs.length ? `Errores al guardar: ${errs.join('; ')}` : 'Proyecciones guardadas ✓');
                }}
                className="inline-flex items-center gap-1 rounded border border-emerald-500 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
              >
                <Save className="h-3 w-3" /> Guardar proyecciones ({nEdits})
              </button>
              <button
                onClick={() => setProyEdits({})}
                className="inline-flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                <RotateCcw className="h-3 w-3" /> Descartar ({nEdits})
              </button>
            </>
          )}
          {saveMsg && <span className="text-xs font-medium text-emerald-700">{saveMsg}</span>}
        </div>
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          Última sincronización: <strong>{syncDate}</strong> (corrida{' '}
          <span className="font-mono">{payload.sync.id.slice(0, 8)}</span>). Mismo motor de cálculo que la réplica
          (paridad 2,752/2,752 con el libro de Alexis). Proyección por defecto = promedio móvil de{' '}
          {payload.config.mesesPromedioMovil} meses completos, editable; pendientes por surtir cuentan solo con edad ≤{' '}
          {payload.config.maxEdadPendientesDias} días; tránsito = facturado no recibido (entregas directas aparte).
          Las ediciones se guardan con autor e historial (proyección, precios, NC, ETA, plan).
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
        <TabModelo
          payload={payload}
          computed={computed}
          proyEdits={proyEdits}
          setProyEdits={setProyEdits}
          onClearOverride={async (codigo) => {
            const e = await postJson('/api/inventarios/reyma/proyeccion', { codigo, cajas: null });
            if (!e) load();
            flash(e ? `Error: ${e}` : `Proyección de ${codigo} vuelve a automática ✓`);
          }}
          flash={flash}
          onSaved={load}
        />
      )}
      {tab === 'pedido' && <TabPedido payload={payload} computed={computed} flash={flash} onSaved={load} />}
      {tab === 'mrp' && (
        <TabMrp payload={payload} mrpSorted={computed.mrpSorted} flash={flash} onSaved={load} />
      )}
      {tab === 'nc' && <TabNc payload={payload} flash={flash} onSaved={load} />}
      {tab === 'cumplimiento' && <TabCumplimiento payload={payload} />}
      {tab === 'ventas' && <TabVentas payload={payload} computed={computed} />}
      {tab === 'datos' && <TabDatos payload={payload} flash={flash} onSaved={load} />}
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
  onClearOverride,
  flash,
  onSaved,
}: {
  payload: ReymaVivoPayload;
  computed: Computed;
  proyEdits: Record<string, number>;
  setProyEdits: (e: Record<string, number>) => void;
  onClearOverride: (codigo: string) => void;
  flash: (m: string) => void;
  onSaved: () => void;
}) {
  // C3: búsqueda, filtro por categoría, agrupar, ordenar por nivel (pedidos de Alexis en la demo)
  const [q, setQ] = useState('');
  const [catSel, setCatSel] = useState<string>('');
  const [agrupar, setAgrupar] = useState(false);
  const [ordenNivel, setOrdenNivel] = useState(false);
  const nivelByCod = useMemo(
    () => new Map(computed.mrpSorted.map((d) => [d.cod, d.l])),
    [computed.mrpSorted],
  );
  const categorias = useMemo(
    () => [...new Set(payload.rows.map((r) => r.cat))].sort(),
    [payload.rows],
  );
  const visibles = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = computed.der.filter(({ row: r }) => {
      if (catSel && r.cat !== catSel) return false;
      if (query &&
        !(r.cod.includes(query) || r.clave.toLowerCase().includes(query) ||
          (r.desc || '').toLowerCase().includes(query) || (r.prodReyma || '').toLowerCase().includes(query))) {
        return false;
      }
      return true;
    });
    if (ordenNivel) {
      list = [...list].sort(
        (a, b) => (nivelByCod.get(a.row.cod) ?? 999) - (nivelByCod.get(b.row.cod) ?? 999),
      );
    }
    if (agrupar) {
      list = [...list].sort((a, b) =>
        a.row.cat === b.row.cat ? 0 : a.row.cat.localeCompare(b.row.cat));
    }
    return list;
  }, [computed.der, q, catSel, ordenNivel, agrupar, nivelByCod]);

  const guardarPrecio = async (codigo: string, actual: number, nuevo: number) => {
    if (!isFinite(nuevo) || nuevo <= 0 || Math.abs(nuevo - actual) < 1e-9) return;
    const e = await postJson('/api/inventarios/reyma/precio', { codigo, precio: nuevo });
    if (!e) onSaved();
    flash(e ? `Error: ${e}` : `Precio de ${codigo} → ${nuevo} ✓`);
  };

  let lastCat: string | null = null;
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      {/* C3: controles "acá arriba… a un solo lado" */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <input
          type="search"
          placeholder="Buscar código / clave / descripción…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-64 rounded border border-slate-300 px-2 py-1"
        />
        <select
          value={catSel}
          onChange={(e) => setCatSel(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={agrupar} onChange={(e) => setAgrupar(e.target.checked)} />
          Agrupar por categoría
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={ordenNivel} onChange={(e) => setOrdenNivel(e.target.checked)} />
          Menor nivel de inventario primero
        </label>
        <span className="text-slate-400">{visibles.length}/{computed.der.length} productos</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>Código</th>
              <th className={TH}>Clave</th>
              <th className={TH}>Descripción</th>
              <th className={TH}>Categoría</th>
              <th className={THR}>Precio USD</th>
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
            {visibles.map(({ row: r, d }) => {
              const header =
                agrupar && r.cat !== lastCat ? (
                  <tr key={`h-${r.cat}`} className="bg-emerald-50">
                    <td className={`${TD} font-semibold text-emerald-800`} colSpan={18}>
                      {r.cat} · {visibles.filter((x) => x.row.cat === r.cat).length} productos ·{' '}
                      {qty(visibles.filter((x) => x.row.cat === r.cat).reduce((a, x) => a + x.d.u, 0))} cajas pedido ·{' '}
                      {m3(visibles.filter((x) => x.row.cat === r.cat).reduce((a, x) => a + x.d.v, 0))} m³
                    </td>
                  </tr>
                ) : null;
              lastCat = r.cat;
              return [
                header,
              <tr key={r.cod} className="border-t border-slate-100 hover:bg-slate-50">
                <td className={`${TD} font-mono`}>{r.cod}</td>
                <td className={TD}>{r.clave}</td>
                <td className={`${TD} max-w-[240px] truncate`} title={r.prodReyma}>
                  {r.desc || r.prodReyma}
                </td>
                <td className={TD}>
                  {r.cat}
                  {r.categoriaEsFallback && (
                    <span className="ml-1 rounded bg-slate-200 px-1 text-[9px]" title="Sin x_studio_material en Odoo — categoría del Excel de respaldo">
                      xlsx
                    </span>
                  )}
                </td>
                <td className={TDR}>
                  <input
                    key={`${r.cod}-${r.precio}`}
                    type="number"
                    step="0.01"
                    min={0}
                    defaultValue={r.precio || ''}
                    onBlur={(e) => guardarPrecio(r.cod, r.precio, Number(e.target.value))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="w-20 rounded border border-yellow-300 bg-yellow-50 px-1 py-0.5 text-right text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    title="Precio de compra editable (C2) — se guarda al salir de la celda; alimenta NC y verificación de precios"
                  />
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
                  <span className="inline-flex items-center gap-1">
                    {r.proyOverride && r.proyeccionInfo && (
                      <>
                        <span
                          className="rounded bg-purple-100 px-1 text-[9px] font-bold text-purple-700"
                          title={`Override guardado por ${r.proyeccionInfo.autor} (${new Date(r.proyeccionInfo.fecha).toLocaleDateString('es-GT')})`}
                        >
                          AJ
                        </span>
                        <button
                          onClick={() => onClearOverride(r.cod)}
                          title="Volver a la proyección automática (promedio móvil)"
                          className="text-slate-400 hover:text-red-600"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    )}
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
                          ? 'Editado — usa "Guardar proyecciones" arriba para persistir'
                          : r.proyOverride
                            ? 'Override persistido (AJ)'
                            : `Promedio móvil ${payload.config.mesesPromedioMovil} meses — editable ("yo corrijo")`
                      }
                    />
                  </span>
                </td>
                <td className={TDR}>{qty(d.r)}</td>
                <td className={`${TDR} font-semibold ${d.u > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{qty(d.u)}</td>
                <td className={TDR}>{m3(d.v)}</td>
              </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabMrp({
  payload,
  mrpSorted,
  flash,
  onSaved,
}: {
  payload: ReymaVivoPayload;
  mrpSorted: MrpDerived[];
  flash: (m: string) => void;
  onSaved: () => void;
}) {
  const [bodega, setBodega] = useState<'SJ' | 'ZAC' | 'PET' | 'Z11'>('SJ');
  const [objetivo, setObjetivo] = useState(OBJETIVO_SEMANAS_REGIONAL_DEFAULT);
  const regional = useMemo(
    () =>
      bodega === 'SJ'
        ? null
        : mrpRegional(payload.rows, bodega, objetivo, payload.config.capacidadM3),
    [payload, bodega, objetivo],
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-700">Bodega:</span>
        {(['SJ', 'ZAC', 'PET', 'Z11'] as const).map((b) => (
          <button
            key={b}
            onClick={() => setBodega(b)}
            className={`rounded px-2.5 py-1 font-medium border ${
              bodega === b
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {{ SJ: 'San José (semanal)', ZAC: 'Zacapa', PET: 'Petén', Z11: 'Zona 11' }[b]}
          </button>
        ))}
        {bodega !== 'SJ' && (
          <>
            <span className="text-slate-600 ml-2">Nivelar a</span>
            <input
              type="number"
              min={1}
              max={8}
              value={objetivo}
              onChange={(e) => setObjetivo(Math.max(1, Math.min(8, Number(e.target.value) || 3)))}
              className="w-14 rounded border border-slate-300 px-1 py-0.5 text-right"
              title='"tratemos de que el inventario máximo de todos queden en tres semanas" (Alexis)'
            />
            <span className="text-slate-600">semanas</span>
          </>
        )}
      </div>
      {regional && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded bg-slate-100 px-2 py-1">{fmt(regional.totalCajas)} cajas a pedir</span>
            <span className="rounded bg-slate-100 px-2 py-1">
              {m3(regional.totalM3)} m³ ≈ {fmt(regional.furgonesEstimados)} furgones
            </span>
            <span className="rounded bg-amber-50 px-2 py-1 text-amber-800">
              Demanda = ventas de {{ SJ: 'San José', ZAC: 'Zacapa', PET: 'Petén', Z11: 'Zona 11' }[bodega]} (promedio móvil por
              bodega — nunca la global). Nivelación: «el que está de una semana sube a {objetivo} y el que está de dos
              sube a {objetivo}».
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Código</th>
                  <th className={TH}>Clave</th>
                  <th className={TH}>Descripción</th>
                  <th className={THR}>Inv. bodega</th>
                  <th className={THR}>PxS (≤8d)</th>
                  <th className={THR}>Tránsito</th>
                  <th className={THR}>Neto</th>
                  <th className={THR}>Prom. mensual</th>
                  <th className={THR}>Venta sem.</th>
                  <th className={THR}>Pedido</th>
                  <th className={THR}>Nivel (sem)</th>
                  <th className={THR}>m³</th>
                </tr>
              </thead>
              <tbody>
                {regional.rows.map((r) => (
                  <tr key={r.cod} className={`border-t border-slate-100 ${r.nivel < 2 ? 'bg-red-50' : 'hover:bg-slate-50'}`}>
                    <td className={`${TD} font-mono`}>{r.cod}</td>
                    <td className={TD}>{r.clave}</td>
                    <td className={`${TD} max-w-[240px] truncate`} title={r.desc}>{r.desc}</td>
                    <td className={TDR}>{qty(r.inv)}</td>
                    <td className={TDR}>{qty(r.psx)}</td>
                    <td className={TDR}>{qty(r.transito)}</td>
                    <td className={`${TDR} font-medium ${r.neto < 0 ? 'text-red-600' : ''}`}>{qty(r.neto)}</td>
                    <td className={TDR}>{qty(r.proyMensual)}</td>
                    <td className={TDR}>{qty(r.ventaSem)}</td>
                    <td className={`${TDR} font-semibold ${r.pedido > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {qty(r.pedido)}
                    </td>
                    <td className={TDR}>
                      {r.nivel === 999 ? '—' : r.nivel.toLocaleString('es-GT', { maximumFractionDigits: 2 })}
                    </td>
                    <td className={TDR}>{m3(r.m3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {bodega === 'SJ' && (
      <>
      <PlanPanel payload={payload} mrpSorted={mrpSorted} flash={flash} onSaved={onSaved} />
      <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="mb-2 text-[11px] text-slate-500">
        Ordenado por nivel de inventario (menor cobertura = mayor prioridad). Inv. Disp. Bodega = San José + Patios −
        PxS (regla confirmada por Alexis).
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
      </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- cumplimiento (C7)

/**
 * N14 — Conciliación factura PDF ↔ vendor bill de Odoo: enlaces vigentes con su
 * procedencia + cola de excepciones.
 *
 * La cola sólo trae lo que un humano tiene que resolver. Que una factura PDF no
 * tenga contraparte en Odoo NO es excepción: es el estado normal (el PDF llega
 * días antes que contabilidad).
 */
const MOTIVO_ETIQUETA: Record<Excepcion['motivo'], string> = {
  AMBIGUO: 'Ambigua',
  FECHA_DISCREPA: 'Fecha discrepa',
  LINEAS_DISCREPAN: 'Líneas discrepan',
  MONTO_DISCREPA: 'Monto discrepa',
};

function PanelConciliacion({
  mes, efectivos, persistidos, excepciones, odooSinPdf,
}: {
  mes: string;
  /** Salida del motor: los enlaces que YA están descontando del facturado. */
  efectivos: Enlace[];
  /** Filas de reyma_factura_match: el rastro auditable + los overrides. */
  persistidos: EnlaceFactura[];
  excepciones: Excepcion[];
  odooSinPdf: string[];
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const filaPersistida = new Map(persistidos.map((e) => [`${e.folioFiscal}|${e.odooFactura}`, e]));
  const rechazados = persistidos.filter((e) => e.estado === 'rechazado');
  // Enlaces que el motor está aplicando pero que todavía no tienen fila: el
  // número ya es correcto, lo que falta es dejar el rastro.
  const sinPersistir = efectivos.filter(
    (e) => !filaPersistida.has(`${e.folioFiscal}|${e.odooFactura}`),
  );

  const correr = async () => {
    setOcupado(true);
    const err = await postJson('/api/inventarios/reyma/conciliacion', { accion: 'ejecutar', mes });
    setOcupado(false);
    setMsg(err ?? 'Conciliación ejecutada — recargá para ver los enlaces nuevos.');
  };
  const decidir = async (x: Excepcion, odooFactura: string, estado: 'confirmado' | 'rechazado') => {
    setOcupado(true);
    const err = await postJson('/api/inventarios/reyma/conciliacion', {
      accion: 'decidir', mes, folioFiscal: x.folioFiscal, factura: x.factura, odooFactura, estado,
    });
    setOcupado(false);
    setMsg(err ?? `${x.factura} ${estado === 'confirmado' ? 'enlazada' : 'desligada'} de ${odooFactura} — recargá.`);
  };

  return (
    <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-slate-700">Conciliación PDF ↔ Odoo</b>
        <span>
          {efectivos.length} enlace{efectivos.length === 1 ? '' : 's'} aplicado{efectivos.length === 1 ? '' : 's'}
          {sinPersistir.length > 0 && (
            <span className="ml-1 rounded bg-slate-200 px-1">
              {sinPersistir.length} sin registrar
            </span>
          )}
          {rechazados.length > 0 && ` · ${rechazados.length} par${rechazados.length === 1 ? '' : 'es'} rechazado${rechazados.length === 1 ? '' : 's'} a mano`}
          {excepciones.length > 0 && (
            <span className="ml-1 rounded bg-amber-100 px-1 font-semibold text-amber-800">
              {excepciones.length} en cola
            </span>
          )}
          {odooSinPdf.length > 0 && ` · ${odooSinPdf.length} bill(s) de Odoo sin PDF`}
        </span>
        <button
          type="button" onClick={correr} disabled={ocupado}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium hover:bg-slate-100 disabled:opacity-50"
        >
          Ejecutar conciliación
        </button>
        <button
          type="button" onClick={() => setAbierto((v) => !v)}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-100"
        >
          {abierto ? 'Ocultar detalle' : 'Ver detalle'}
        </button>
        {msg && <span className="text-slate-700">{msg}</span>}
      </div>

      {abierto && (
        <div className="mt-2 space-y-3">
          {efectivos.length > 0 && (
            <div>
              <div className="mb-1 font-semibold text-slate-700">
                Enlaces aplicados (procedencia)
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-[11px]">
                  <thead className="text-slate-500">
                    <tr>
                      {['Factura PDF', 'Bill de Odoo', 'Tier', 'Regla', 'Estado', 'Quién / cuándo'].map((h) => (
                        <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {efectivos.map((e) => {
                      const fila = filaPersistida.get(`${e.folioFiscal}|${e.odooFactura}`);
                      return (
                        <tr key={`${e.folioFiscal}|${e.odooFactura}`} className="border-t border-slate-200">
                          <td className="px-2 py-1 font-mono">{e.factura}</td>
                          <td className="px-2 py-1 font-mono">{e.odooFactura}</td>
                          <td className="px-2 py-1 tabular-nums">{e.tier}</td>
                          <td className="px-2 py-1">{e.regla}</td>
                          <td className="px-2 py-1">
                            <span className={e.estado === 'confirmado'
                              ? 'rounded bg-emerald-100 px-1 font-semibold text-emerald-800'
                              : 'rounded bg-slate-200 px-1'}
                            >
                              {e.estado}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-slate-500">
                            {fila
                              ? `${fila.autor} · ${fila.fecha.slice(0, 10)}`
                              : 'sin registrar — apretá «Ejecutar conciliación» para dejar el rastro'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {excepciones.length > 0 && (
            <div>
              <div className="mb-1 font-semibold text-slate-700">
                Cola de excepciones — necesitan una decisión humana
              </div>
              <div className="space-y-2">
                {excepciones.map((x) => (
                  <div key={x.folioFiscal} className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-amber-200 px-1 font-semibold text-amber-900">
                        {MOTIVO_ETIQUETA[x.motivo]}
                      </span>
                      <b className="font-mono">{x.factura}</b>
                      <span className="text-slate-600">{x.detalle}</span>
                    </div>
                    <table className="mt-1 min-w-full text-[11px]">
                      <thead className="text-slate-500">
                        <tr>
                          {['Bill candidata', 'Por qué', 'Total PDF', 'Total Odoo', 'Fecha PDF', 'Fecha Odoo', ''].map((h) => (
                            <th key={h} className="px-2 py-0.5 text-left font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {x.candidatos.map((c) => (
                          <tr key={c.odooFactura} className="border-t border-amber-200">
                            <td className="px-2 py-0.5 font-mono">{c.odooFactura}</td>
                            <td className="px-2 py-0.5">{c.regla}</td>
                            <td className="px-2 py-0.5 tabular-nums">${fmt(c.evidencia.totalPdf)}</td>
                            <td className="px-2 py-0.5 tabular-nums">${fmt(c.evidencia.totalOdoo)}</td>
                            <td className="px-2 py-0.5">{c.evidencia.fechaPdf}</td>
                            <td className="px-2 py-0.5">{c.evidencia.fechaOdoo ?? '—'}</td>
                            <td className="px-2 py-0.5">
                              <button
                                type="button" disabled={ocupado}
                                onClick={() => decidir(x, c.odooFactura, 'confirmado')}
                                className="mr-1 rounded border border-emerald-300 bg-white px-1.5 py-0.5 font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                              >
                                Es la misma
                              </button>
                              <button
                                type="button" disabled={ocupado}
                                onClick={() => decidir(x, c.odooFactura, 'rechazado')}
                                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 hover:bg-slate-100 disabled:opacity-50"
                              >
                                No lo es
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          )}

          {odooSinPdf.length > 0 && (
            <div className="text-slate-600">
              <b className="text-slate-700">Bills de Odoo sin factura PDF:</b>{' '}
              <span className="font-mono">{odooSinPdf.join(', ')}</span> — puede ser que el PDF
              nunca llegó al grupo. No bloquea el conteo (esas bills ya suman por el lado Odoo).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabCumplimiento({ payload }: { payload: ReymaVivoPayload }) {
  const og = payload.ordenGlobal;
  const pedido = payload.ultimoPedido;
  const rowsByCod = useMemo(() => new Map(payload.rows.map((r) => [r.cod, r])), [payload.rows]);

  // Preferred baseline: the real Odoo PO (C7, unblocked 2026-08-12 by PO-P-3003).
  // N14 — el motor puro corre acá con las DECISIONES HUMANAS ya persistidas
  // (confirmaciones y rechazos de reyma_factura_match) como entrada. Su salida
  // es el conjunto efectivo de enlaces.
  //
  // Deliberado: el número NO depende de que alguien haya apretado el botón. La
  // persistencia es rastro auditable y canal de override — no la condición para
  // que el fill rate esté bien. Si el dedupe dependiera de una fila escrita,
  // una carga nueva sin conciliar volvería a mostrar el doble conteo de N14.
  const conciliacion = useMemo(() => {
    if (!og) return null;
    return conciliar(
      payload.facturas, payload.facturasPdf, og.mes.slice(0, 7),
      payload.enlacesFactura.map((e) => ({
        folioFiscal: e.folioFiscal, odooFactura: e.odooFactura, estado: e.estado,
        tier: e.tier, regla: e.regla, autor: e.autor, fecha: e.fecha,
      })),
    );
  }, [og, payload.facturas, payload.facturasPdf, payload.enlacesFactura]);
  const enlacesAplicados = useMemo(
    () => (conciliacion?.enlaces ?? []).map((e) => ({
      factura: e.factura, odooFactura: e.odooFactura,
    })),
    [conciliacion],
  );
  const saldos = useMemo(
    () => (og && og.lineas.length
      ? computeSaldos(og, payload.facturas, payload.facturasPdf, enlacesAplicados)
      : null),
    [og, payload.facturas, payload.facturasPdf, enlacesAplicados],
  );
  const datos = useMemo(() => {
    if (!saldos || !og) return null;
    const porProducto = saldos.rows.map((r) => ({
      ...r,
      desc: rowsByCod.get(r.codigo)?.desc || rowsByCod.get(r.codigo)?.prodReyma
        || (r.codigo.startsWith('odoo:') ? '(producto fuera del alcance Reyma)' : ''),
      cat: rowsByCod.get(r.codigo)?.cat ?? '—',
    }));
    const cats = [...new Set(porProducto.map((p) => p.cat))].sort();
    const porCategoria = cats.map((cat) => {
      const ps = porProducto.filter((p) => p.cat === cat);
      const ped = ps.reduce((a, p) => a + p.pedido, 0);
      const fac = ps.reduce((a, p) => a + p.facturado, 0);
      return { cat, pedido: ped, facturado: fac, fill: ped > 0 ? fac / ped : 0 };
    });
    const pdfTotal = porProducto.reduce((a, p) => a + p.fuentePdf, 0);
    return { mes: og.mes.slice(0, 7), porProducto, porCategoria, pdfTotal };
  }, [saldos, og, rowsByCod]);

  // Fallback (legacy, pre-orden-global): app-saved pedido mensual vs Odoo bills.
  const datosPedidoApp = useMemo(() => {
    if (og?.lineas.length || !pedido) return null;
    const lineas = (pedido.payload as { lineas?: Array<{ codigo: string; cajas: number }> })?.lineas ?? [];
    if (!lineas.length) return null;
    const mes = pedido.mes.slice(0, 7);
    const facturado = new Map<string, number>();
    for (const f of payload.facturas) {
      if (!f.fecha || !f.fecha.startsWith(mes)) continue;
      const sign = f.tipo === 'nota_credito' ? -1 : 1;
      facturado.set(f.codigo, (facturado.get(f.codigo) ?? 0) + sign * f.cantidad);
    }
    return { mes, lineas, facturado };
  }, [og, pedido, payload.facturas]);

  if (!datos || !saldos || !og) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-4 text-sm text-slate-600">
        {datosPedidoApp
          ? 'Hay un pedido mensual guardado en la app pero ninguna PO global registrada — registra la PO del mes '
            + '(POST orden-global o pedirle a Jorge) para ver saldos y fill rate contra la orden real de Odoo.'
          : 'Sin PO global registrada para el mes — cuando Alexis registre "la orden de agosto es PO-…", la '
            + 'siguiente sincronización trae sus líneas y aquí aparecen los saldos y el fill rate en vivo.'}
      </div>
    );
  }
  const barra = (fill: number) => (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded bg-slate-200">
        <div
          className={`h-full ${fill >= 1 ? 'bg-emerald-500' : fill >= 0.8 ? 'bg-blue-500' : 'bg-amber-500'}`}
          style={{ width: `${Math.min(100, fill * 100)}%` }}
        />
      </div>
      <span className="tabular-nums">{(fill * 100).toLocaleString('es-GT', { maximumFractionDigits: 1 })}%</span>
    </div>
  );
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-1">
        Saldos y fill rate — orden global {og.poName} ({datos.mes}) · registrada por {og.autor}
      </h3>
      <div className="mb-3 text-[11px] text-slate-500">
        Pedido = líneas de {og.poName} en Odoo (sincronizadas). Facturado = facturas de proveedor en Odoo{' '}
        <b>+ facturas PDF del correo</b> (fuente adelantada — contabilidad tarda días en registrarlas;
        cuando la misma factura aparece en Odoo, la versión Odoo gana). Notas de crédito restan.
        «El porcentaje de cumplimiento del fill rate que el proveedor tenga… en vivo» (Alexis).
      </div>
      {datos.pdfTotal > 0 && (
        <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
          {fmt(datos.pdfTotal)} cajas del facturado provienen SOLO de facturas PDF aún no registradas en Odoo
          (marcadas <span className="rounded bg-blue-100 px-1 font-semibold">PDF</span> por producto).
          {saldos.supersededPdf.length > 0
            && ` · ${saldos.supersededPdf.length} facturas PDF ya registradas en Odoo (deduplicadas): ${saldos.supersededPdf.join(', ')}.`}
        </div>
      )}
      <PanelConciliacion
        mes={og.mes.slice(0, 7)}
        efectivos={conciliacion?.enlaces ?? []}
        persistidos={payload.enlacesFactura}
        excepciones={conciliacion?.excepciones ?? []}
        odooSinPdf={conciliacion?.odooSinPdf ?? []}
      />
      {saldos.directasExcluidas.cajas > 0 && (
        <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          Entregas directas del mes ({saldos.directasExcluidas.facturas.join(', ')}:{' '}
          {fmt(saldos.directasExcluidas.cajas)} cajas) NO descuentan la orden global — pertenecen a sus
          órdenes hijas PO-PZ11 (mecánica Z11 de Alexis) y se excluyen de este conteo.
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { l: 'Pedido (cajas)', v: fmt(saldos.totales.pedido) },
          { l: 'Facturado (cajas)', v: fmt(saldos.totales.facturado) },
          { l: 'Recibidas (cajas)', v: fmt(saldos.totales.recibidas) },
          { l: 'Saldo (cajas)', v: fmt(saldos.totales.pedido - saldos.totales.facturado) },
          { l: 'Fill rate global', v: `${(saldos.totales.fill * 100).toLocaleString('es-GT', { maximumFractionDigits: 1 })}%` },
        ].map((k) => (
          <div key={k.l} className="rounded-lg border border-slate-200 px-3 py-2">
            <div className="text-[11px] text-slate-500">{k.l}</div>
            <div className="text-lg font-bold text-slate-800 tabular-nums">{k.v}</div>
          </div>
        ))}
      </div>
      <table className="text-xs border-collapse min-w-[480px] mb-4">
        <thead className="bg-slate-50">
          <tr>
            <th className={TH}>Categoría</th>
            <th className={THR}>Pedido</th>
            <th className={THR}>Facturado</th>
            <th className={TH}>Fill</th>
          </tr>
        </thead>
        <tbody>
          {datos.porCategoria.map((c) => (
            <tr key={c.cat} className="border-t border-slate-100">
              <td className={TD}>{c.cat}</td>
              <td className={TDR}>{qty(c.pedido)}</td>
              <td className={TDR}>{qty(c.facturado)}</td>
              <td className={TD}>{barra(c.fill)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>Código</th>
              <th className={TH}>Descripción</th>
              <th className={THR}>Pedido</th>
              <th className={THR}>Facturado</th>
              <th className={THR}>Recibidas</th>
              <th className={THR}>Saldo</th>
              <th className={TH}>Fill</th>
            </tr>
          </thead>
          <tbody>
            {[...datos.porProducto].sort((a, b) => a.fill - b.fill).map((p) => (
              <tr key={p.codigo} className="border-t border-slate-100 hover:bg-slate-50">
                <td className={`${TD} font-mono`}>{p.codigo}</td>
                <td className={`${TD} max-w-[280px] truncate`} title={p.desc}>{p.desc}</td>
                <td className={TDR}>{qty(p.pedido)}</td>
                <td className={TDR}>
                  {qty(p.facturado)}
                  {p.fuentePdf > 0 && (
                    <span
                      className="ml-1 rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-700"
                      title={`${fmt(p.fuentePdf)} cajas de facturas PDF aún no registradas en Odoo`}
                    >
                      PDF
                    </span>
                  )}
                </td>
                <td className={TDR}>{qty(p.recibidas)}</td>
                <td className={`${TDR} ${p.saldo < 0 ? 'text-red-600' : ''}`}>{qty(p.saldo)}</td>
                <td className={TD}>{barra(p.fill)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FacturasEta payload={payload} />
      {saldos.fueraDePedido.length > 0 && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Facturado FUERA de {og.poName} ({saldos.fueraDePedido.length} productos):{' '}
          {saldos.fueraDePedido.map((x) => `${x.codigo} (${fmt(x.total)})`).join(' · ')} — p. ej. los excedentes
          del MRP semanal que la orden global no traía (el caso que Alexis ajusta en Odoo), o facturas de otra OC.
        </div>
      )}
    </div>
  );
}

/**
 * Lote 1 — facturas del proveedor con su ETA. Alexis: "a partir de esa factura
 * en PDF calculamos el ETA… son cuatro días hábiles" y "muchos me preguntan:
 * ¿y cuándo entra la bandeja esta 1052?".
 * La ETA manual gana sobre la calculada, y cuando difieren se muestran AMBAS —
 * la diferencia es un hallazgo para conversar, no algo que la app deba esconder.
 */
function FacturasEta({ payload }: { payload: ReymaVivoPayload }) {
  const filas = useMemo(() => {
    const porFactura = new Map<string, {
      factura: string; guia: string | null; destino: string | null;
      fecha: string | null; etaManual: string | null; cajas: number; lineas: number;
    }>();
    for (const f of payload.facturasPdf) {
      const e = porFactura.get(f.factura) ?? {
        factura: f.factura, guia: f.guia, destino: f.destino,
        fecha: f.fecha, etaManual: f.eta, cajas: 0, lineas: 0,
      };
      e.cajas += f.cantidad;
      e.lineas += 1;
      if (f.eta && !e.etaManual) e.etaManual = f.eta;
      porFactura.set(f.factura, e);
    }
    return [...porFactura.values()]
      .map((f) => ({
        ...f,
        eta: resolverEta({ fecha: f.fecha, destino: f.destino, eta: f.etaManual }, payload.etaConfig),
      }))
      .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));
  }, [payload.facturasPdf, payload.etaConfig]);

  if (!filas.length) return null;
  const cfg = payload.etaConfig;
  const resumenCfg = Object.entries(cfg.porDestino)
    .map(([d, n]) => `${d.replace('bodega-', '')}: ${n}`)
    .join(' · ') || `todas: ${cfg.default}`;

  return (
    <div className="mt-5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
        Facturas del proveedor y su ETA
      </h4>
      <div className="mb-2 text-[11px] text-slate-500">
        ETA = fecha de la factura + días hábiles del destino (sáb y dom no cuentan; feriados
        todavía no). Días hábiles configurados — <b>{resumenCfg}</b>. La ETA escrita a mano gana
        sobre la calculada; si difieren, se muestran las dos.
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>Factura</th>
              <th className={TH}>Guía</th>
              <th className={TH}>Destino</th>
              <th className={TH}>Fecha factura</th>
              <th className={TH}>ETA</th>
              <th className={THR}>Cajas</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.factura} className="border-t border-slate-100 hover:bg-slate-50">
                <td className={`${TD} font-mono`}>{f.factura}</td>
                <td className={`${TD} text-slate-500`}>{f.guia ?? '—'}</td>
                <td className={TD}>
                  {(f.destino ?? '—').replace('bodega-', '')}
                  {f.destino === 'entrega-directa' && (
                    <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-600">directa</span>
                  )}
                </td>
                <td className={TD}>{f.fecha ?? '—'}</td>
                <td className={TD}>
                  {f.eta.fecha ? (
                    <>
                      <b>{f.eta.fecha}</b>
                      <span
                        className={`ml-1 rounded px-1 text-[10px] ${
                          f.eta.fuente === 'manual'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                        title={f.eta.fuente === 'manual'
                          ? 'ETA declarada a mano (gana sobre la calculada)'
                          : `Calculada: ${f.fecha} + ${diasHabilesDe(f.destino, cfg)} días hábiles`}
                      >
                        {f.eta.fuente === 'manual' ? 'manual' : 'calculada'}
                      </span>
                      {f.eta.calculadaDistinta && (
                        <span
                          className="ml-1 text-amber-600"
                          title={`La calculada con la config actual daría ${f.eta.calculadaDistinta} — revisar los días hábiles de este destino`}
                        >
                          (calc. {f.eta.calculadaDistinta})
                        </span>
                      )}
                    </>
                  ) : '—'}
                </td>
                <td className={TDR}>{qty(f.cajas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- plan panel

const DIAS_TODOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

function proximoLunes(): string {
  const d = new Date();
  const add = ((8 - d.getDay()) % 7) || 7;
  const lunes = new Date(d.getFullYear(), d.getMonth(), d.getDate() + add);
  return `${lunes.getFullYear()}-${String(lunes.getMonth() + 1).padStart(2, '0')}-${String(lunes.getDate()).padStart(2, '0')}`;
}

function PlanPanel({
  payload,
  mrpSorted,
  flash,
  onSaved,
}: {
  payload: ReymaVivoPayload;
  mrpSorted: MrpDerived[];
  flash: (m: string) => void;
  onSaved: () => void;
}) {
  const [dias, setDias] = useState<string[]>(DIAS_DEFAULT);
  const [maxPorDia, setMaxPorDia] = useState(3);
  const [plan, setPlan] = useState<PlanFurgon[] | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [cajasEdits, setCajasEdits] = useState<Record<string, number>>({});

  const generar = () => {
    const r = generarPlan(mrpSorted, {
      capacidadM3: payload.config.capacidadM3,
      codFurgonCompleto: payload.config.codFurgonCompleto,
      dias,
      maxPorDia,
    });
    setPlan(r.furgones);
    setAvisos(r.avisos);
    setCajasEdits({});
  };

  const cap = payload.config.capacidadM3;
  const efectivo = (f: PlanFurgon, li: number) =>
    cajasEdits[`${f.no}|${li}`] ?? f.lineas[li].cajas;
  const totalM3 = (f: PlanFurgon) =>
    f.lineas.reduce((a, l, i) => a + efectivo(f, i) * l.cubicaje, 0);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 mb-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
        <Truck className="h-4 w-4" /> Plan semanal de despacho (bin-packing 100 m³ — reglas del libro)
      </h3>
      <div className="flex flex-wrap items-center gap-3 text-xs mb-3">
        <span className="text-slate-600">Días:</span>
        {DIAS_TODOS.map((d) => (
          <label key={d} className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={dias.includes(d)}
              onChange={(e) =>
                setDias(e.target.checked ? DIAS_TODOS.filter((x) => dias.includes(x) || x === d) : dias.filter((x) => x !== d))
              }
            />
            {d}
            {d === 'Jueves' && (
              <span className="text-[10px] text-slate-400" title="Excluido por preferencia (llega en fin de semana) — no está escrito en piedra (Alexis)">
                *
              </span>
            )}
          </label>
        ))}
        <span className="text-slate-600 ml-2">Máx furgones/día:</span>
        <input
          type="number"
          min={1}
          max={6}
          value={maxPorDia}
          onChange={(e) => setMaxPorDia(Math.max(1, Math.min(6, Number(e.target.value) || 3)))}
          className="w-14 rounded border border-slate-300 px-1 py-0.5 text-right"
          title="La recepción total es de 6 furgones/día COMPARTIDA con Wilmer (regla 5)"
        />
        <button
          onClick={generar}
          className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700"
        >
          Generar plan
        </button>
        {plan && (
          <button
            onClick={async () => {
              const payloadPlan = {
                dias: dias.map((dia) => ({
                  dia,
                  furgones: plan
                    .filter((f) => f.dia === dia)
                    .map((f) => ({
                      no: f.no,
                      lineas: f.lineas.map((l, i) => ({ codigo: l.cod, cajas: efectivo(f, i) })),
                    })),
                })),
                sinDia: plan
                  .filter((f) => f.dia === null)
                  .map((f) => ({
                    no: f.no,
                    lineas: f.lineas.map((l, i) => ({ codigo: l.cod, cajas: efectivo(f, i) })),
                  })),
              };
              const e = await postJson('/api/inventarios/reyma/plan', {
                semana: proximoLunes(),
                payload: payloadPlan,
              });
              if (!e) onSaved();
              flash(e ? `Error al guardar plan: ${e}` : `Plan de la semana del ${proximoLunes()} guardado ✓`);
            }}
            className="inline-flex items-center gap-1 rounded border border-emerald-500 bg-emerald-50 px-3 py-1 font-medium text-emerald-800 hover:bg-emerald-100"
          >
            <Save className="h-3 w-3" /> Guardar plan
          </button>
        )}
        {plan && (
          <button
            onClick={() => {
              // C6: documento EXTERNO para el proveedor — "un PDF o algo… la guía
              // para no dejar al proveedor a que despache lo que quiera" (Alexis).
              // Nunca entra a Odoo; se descuenta de la orden global vía factura.
              let cuerpo =
                `<h1>PEDIDO SEMANAL DE DESPACHO — LÍNEA REYMA</h1>` +
                `<div class="meta">PLASTICENTRO S.A. · Atención: Iván / Viridiana · ` +
                `Semana del ${esc(proximoLunes())} · Capacidad por furgón: ${payload.config.capacidadM3} m³ · ` +
                `Asociado al pedido mensual vigente${payload.ultimoPedido ? ` (${esc(payload.ultimoPedido.mes.slice(0, 7))})` : ''}</div>`;
              const dias = [...new Set(plan.map((f) => f.dia ?? 'SIN DÍA'))];
              for (const dia of dias) {
                cuerpo += `<h2>${esc(dia)}</h2>`;
                for (const f of plan.filter((x) => (x.dia ?? 'SIN DÍA') === dia)) {
                  const tm3 = f.lineas.reduce((a, l, i) => a + efectivo(f, i) * l.cubicaje, 0);
                  cuerpo += `<table><thead><tr><th colspan="3">Furgón ${f.no}${f.dedicado ? ' — dedicado' : ''}</th></tr>` +
                    '<tr><th>Clave proveedor</th><th>Descripción</th><th class="n">Cajas</th></tr></thead><tbody>';
                  f.lineas.forEach((l, i) => {
                    cuerpo += `<tr><td>${esc(l.clave || l.cod)}</td><td>${esc(l.desc)}</td><td class="n">${fmt(efectivo(f, i))}</td></tr>`;
                  });
                  cuerpo += `<tr class="sub"><td colspan="2">Total furgón ${f.no} — ${m3(tm3)} m³</td>` +
                    `<td class="n">${fmt(f.lineas.reduce((a, _l, i) => a + efectivo(f, i), 0))}</td></tr></tbody></table>`;
                }
              }
              cuerpo += '<div class="nota">Si algún producto no está disponible de fábrica, completar el furgón con los ' +
                'comodines autorizados: <b>VT8XN</b> (vaso térmico 8) o <b>VT10XN</b> (vaso térmico 10), y enviar el ' +
                'producto pendiente en el siguiente despacho del furgón completo.</div>';
              const err = abrirImpresion(`Pedido semanal Reyma — semana del ${proximoLunes()}`, cuerpo);
              if (err) flash(err);
            }}
            className="rounded border border-slate-400 bg-slate-50 px-3 py-1 font-medium text-slate-700 hover:bg-slate-100"
          >
            Hoja del proveedor (PDF)
          </button>
        )}
        {payload.ultimoPlan && (
          <span className="text-[11px] text-slate-500">
            Último guardado: semana del {payload.ultimoPlan.semana} por {payload.ultimoPlan.autor} (
            {new Date(payload.ultimoPlan.fecha).toLocaleDateString('es-GT')})
          </span>
        )}
      </div>
      {avisos.map((a) => (
        <div key={a} className="mb-2 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a}
        </div>
      ))}
      {plan && (
        <div className="grid gap-3 lg:grid-cols-3">
          {plan.map((f) => {
            const tm3 = totalM3(f);
            return (
              <div key={f.no} className="rounded border border-slate-200">
                <div className={`border-b px-3 py-1.5 text-xs font-semibold ${f.dia ? 'bg-slate-50 text-slate-700' : 'bg-amber-50 text-amber-800'}`}>
                  Furgón {f.no} — {f.dia ?? 'SIN DÍA (cupo excedido)'}
                  {f.dedicado ? ' · dedicado' : ''}
                </div>
                <table className="w-full text-xs border-collapse">
                  <tbody>
                    {f.lineas.map((l, i) => (
                      <tr key={`${l.cod}-${i}`} className="border-t border-slate-100">
                        <td className={`${TD} font-mono`}>{l.cod}</td>
                        <td className={`${TD} max-w-[140px] truncate`} title={l.desc}>{l.clave}</td>
                        <td className={TDR}>
                          <input
                            type="number"
                            min={0}
                            value={efectivo(f, i)}
                            onChange={(e) =>
                              setCajasEdits({ ...cajasEdits, [`${f.no}|${i}`]: Math.max(0, Number(e.target.value) || 0) })
                            }
                            className="w-16 rounded border border-yellow-300 bg-yellow-50 px-1 py-0.5 text-right tabular-nums"
                            title="Editable — 'yo puedo quitar productos y subir cantidades' (Alexis)"
                          />
                        </td>
                        <td className={TDR}>{m3(efectivo(f, i) * l.cubicaje)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                      <td className={TD} colSpan={2}>Total</td>
                      <td className={TDR}>{qty(f.lineas.reduce((a, _l, i) => a + efectivo(f, i), 0))}</td>
                      <td className={`${TDR} ${tm3 > cap ? 'text-red-600' : ''}`}>
                        {m3(tm3)} ({xround((tm3 / cap) * 100, 1)}%)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
      {!plan && (
        <div className="text-[11px] text-slate-500">
          Genera el plan a partir del MRP (abajo): prioriza menor nivel, llena furgones de {cap} m³, VT10 va en
          furgones dedicados, y asigna días respetando el máximo diario. Las cajas quedan editables antes de guardar.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- pedido mensual (C5)

interface PedidoLinea {
  codigo: string;
  clave: string;
  desc: string;
  cat: string;
  cajas: number;
  precio: number;
  cub: number;
}

function mesSiguiente(): string {
  const d = new Date();
  const n = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1));
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

const MESES_ES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

function TabPedido({
  payload,
  computed,
  flash,
  onSaved,
}: {
  payload: ReymaVivoPayload;
  computed: Computed;
  flash: (m: string) => void;
  onSaved: () => void;
}) {
  const [mes, setMes] = useState<string>(mesSiguiente());
  const [lineas, setLineas] = useState<PedidoLinea[] | null>(null);

  const generar = () => {
    const ls: PedidoLinea[] = computed.der
      .filter(({ d }) => d.u > 0)
      .map(({ row: r, d }) => ({
        codigo: r.cod,
        clave: r.clave,
        desc: r.desc || r.prodReyma,
        cat: r.cat,
        cajas: d.u,
        precio: r.precio,
        cub: r.cub,
      }))
      .sort((a, b) => (a.cat === b.cat ? a.codigo.localeCompare(b.codigo) : a.cat.localeCompare(b.cat)));
    setLineas(ls);
  };

  const totales = useMemo(() => {
    if (!lineas) return null;
    const cajas = lineas.reduce((a, l) => a + l.cajas, 0);
    const usd = lineas.reduce((a, l) => a + l.cajas * l.precio, 0);
    const vol = lineas.reduce((a, l) => a + l.cajas * l.cub, 0);
    return { cajas, usd, vol, furgones: Math.ceil(vol / payload.config.capacidadM3) };
  }, [lineas, payload.config.capacidadM3]);

  const imprimir = () => {
    if (!lineas || !totales) return;
    const [y, m] = mes.split('-');
    const nombreMes = `${MESES_ES[Number(m) - 1]} ${y}`;
    let cuerpo =
      `<h1>ORDEN DE COMPRA — PLASTICOS ADHERIBLES DEL BAJÍO S.A. DE C.V. (GRUPO REYMA)</h1>` +
      `<div class="meta">PLASTICENTRO SOCIEDAD ANÓNIMA · Atención: Iván / Viridiana · ` +
      `Pedido de ${esc(nombreMes)} · Condición: EXW — Hidalgo, México · Moneda: USD · ` +
      `Generado desde el modelo en vivo el ${new Date().toLocaleDateString('es-GT')}</div>`;
    const cats = [...new Set(lineas.map((l) => l.cat))];
    let num = 0;
    cuerpo += '<table><thead><tr><th>#</th><th>Clave proveedor</th><th>Descripción</th>' +
      '<th class="n">Cajas</th><th class="n">Precio unit USD</th><th class="n">Total USD</th></tr></thead><tbody>';
    for (const cat of cats) {
      const ls = lineas.filter((l) => l.cat === cat);
      cuerpo += `<tr class="sub"><td colspan="6">${esc(cat)}</td></tr>`;
      for (const l of ls) {
        num += 1;
        cuerpo += `<tr><td>${num}</td><td>${esc(l.clave || l.codigo)}</td><td>${esc(l.desc)}</td>` +
          `<td class="n">${fmt(l.cajas)}</td><td class="n">${fmt(l.precio, 2)}</td>` +
          `<td class="n">${fmt(l.cajas * l.precio, 2)}</td></tr>`;
      }
      cuerpo += `<tr class="sub"><td colspan="3">SUBTOTAL ${esc(cat)}</td>` +
        `<td class="n">${fmt(ls.reduce((a, l) => a + l.cajas, 0))}</td><td></td>` +
        `<td class="n">${fmt(ls.reduce((a, l) => a + l.cajas * l.precio, 0), 2)}</td></tr>`;
    }
    cuerpo += `<tr class="sub"><td colspan="3">TOTAL GENERAL — ${fmt(totales.furgones)} furgones estimados (${m3(totales.vol)} m³)</td>` +
      `<td class="n">${fmt(totales.cajas)}</td><td></td><td class="n">${fmt(totales.usd, 2)}</td></tr>`;
    cuerpo += '</tbody></table>';
    const err = abrirImpresion(`Pedido Reyma ${nombreMes}`, cuerpo);
    if (err) flash(err);
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-700">Pedido mensual (orden global)</span>
        <span className="text-slate-600">Mes:</span>
        <input
          type="month"
          value={mes.slice(0, 7)}
          onChange={(e) => setMes(`${e.target.value}-01`)}
          className="rounded border border-slate-300 px-1 py-0.5"
        />
        <button onClick={generar} className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700">
          Generar desde el Modelo
        </button>
        {lineas && (
          <>
            <button
              onClick={async () => {
                const e = await postJson('/api/inventarios/reyma/pedido', {
                  mes,
                  payload: { lineas: lineas.map((l) => ({ codigo: l.codigo, cajas: l.cajas, precio: l.precio })) },
                });
                if (!e) onSaved();
                flash(e ? `Error: ${e}` : `Pedido de ${mes.slice(0, 7)} guardado ✓`);
              }}
              className="inline-flex items-center gap-1 rounded border border-emerald-500 bg-emerald-50 px-3 py-1 font-medium text-emerald-800 hover:bg-emerald-100"
            >
              <Save className="h-3 w-3" /> Guardar pedido
            </button>
            <button onClick={imprimir} className="rounded border border-slate-400 bg-slate-50 px-3 py-1 font-medium text-slate-700 hover:bg-slate-100">
              Imprimir / PDF
            </button>
          </>
        )}
        {payload.ultimoPedido && (
          <span className="text-[11px] text-slate-500">
            Último guardado: {payload.ultimoPedido.mes.slice(0, 7)} por {payload.ultimoPedido.autor} (
            {new Date(payload.ultimoPedido.fecha).toLocaleDateString('es-GT')})
          </span>
        )}
      </div>
      {!lineas && (
        <div className="text-[11px] text-slate-500">
          Genera la orden global desde el pedido óptimo del Modelo (productos con pedido &gt; 0). Las cajas quedan
          editables antes de guardar/imprimir — «que sean editables y pueda yo tal vez solo cambiar un valor X»
          (Alexis). Los precios se toman del precio vigente (editable en la pestaña Modelo).
        </div>
      )}
      {lineas && totales && (
        <>
          <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded bg-slate-100 px-2 py-1">{fmt(totales.cajas)} cajas</span>
            <span className="rounded bg-slate-100 px-2 py-1">USD {fmt(totales.usd, 2)}</span>
            <span className="rounded bg-slate-100 px-2 py-1">{m3(totales.vol)} m³ ≈ {fmt(totales.furgones)} furgones</span>
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Código</th>
                  <th className={TH}>Clave</th>
                  <th className={TH}>Descripción</th>
                  <th className={TH}>Categoría</th>
                  <th className={THR}>Cajas</th>
                  <th className={THR}>Precio USD</th>
                  <th className={THR}>Total USD</th>
                  <th className={THR}>m³</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={l.codigo} className="border-t border-slate-100">
                    <td className={`${TD} font-mono`}>{l.codigo}</td>
                    <td className={TD}>{l.clave}</td>
                    <td className={`${TD} max-w-[280px] truncate`} title={l.desc}>{l.desc}</td>
                    <td className={TD}>{l.cat}</td>
                    <td className={TDR}>
                      <input
                        type="number"
                        min={0}
                        value={l.cajas}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value) || 0);
                          setLineas(lineas.map((x, j) => (j === i ? { ...x, cajas: v } : x)));
                        }}
                        className="w-20 rounded border border-yellow-300 bg-yellow-50 px-1 py-0.5 text-right tabular-nums"
                      />
                    </td>
                    <td className={TDR}>{fmt(l.precio, 2)}</td>
                    <td className={TDR}>{fmt(l.cajas * l.precio, 2)}</td>
                    <td className={TDR}>{m3(l.cajas * l.cub)}</td>
                    <td className={TD}>
                      <button
                        onClick={() => setLineas(lineas.filter((_x, j) => j !== i))}
                        className="text-slate-400 hover:text-red-600"
                        title="Quitar producto del pedido («yo pueda quitar productos»)"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- NC tab

function TabNc({
  payload,
  flash,
  onSaved,
}: {
  payload: ReymaVivoPayload;
  flash: (m: string) => void;
  onSaved: () => void;
}) {
  const [tarifa, setTarifa] = useState<number>(payload.ncConfig.tarifaUsd);
  const [hasta, setHasta] = useState<string>(payload.ncConfig.vigenteHasta ?? '');
  const [nota, setNota] = useState<string>('');
  const [mes, setMes] = useState<string>(() => new Date().toISOString().slice(0, 7));

  const rowsByCod = useMemo(() => new Map(payload.rows.map((r) => [r.cod, r])), [payload.rows]);
  const duroport = useMemo(() => {
    const ncSet = new Set(payload.config.ncCodigos);
    const acc = new Map<string, { cajas: number; desc: string; facturas: Set<string> }>();
    for (const f of payload.facturas) {
      if (!f.fecha || !f.fecha.startsWith(mes)) continue;
      const row = rowsByCod.get(f.codigo);
      if (!row || !ncSet.has(f.codigo)) continue;
      const sign = f.tipo === 'nota_credito' ? -1 : 1;
      const cur = acc.get(f.codigo) ?? { cajas: 0, desc: row.desc || row.prodReyma, facturas: new Set<string>() };
      cur.cajas += sign * f.cantidad;
      cur.facturas.add(f.factura);
      acc.set(f.codigo, cur);
    }
    return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [payload.facturas, payload.config.ncCodigos, rowsByCod, mes]);
  const totalCajas = duroport.reduce((a, [, v]) => a + v.cajas, 0);

  const desviaciones = useMemo(() => {
    const out: Array<{ factura: string; fecha: string | null; codigo: string; precio: number; base: number; rel: number }> = [];
    for (const f of payload.facturas) {
      if (f.tipo !== 'factura') continue;
      const base = rowsByCod.get(f.codigo)?.precio ?? 0;
      if (base > 0) {
        const rel = (f.precioUnit - base) / base;
        if (Math.abs(rel) > 0.01) out.push({ factura: f.factura, fecha: f.fecha, codigo: f.codigo, precio: f.precioUnit, base, rel });
      }
    }
    return out.sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel)).slice(0, 40);
  }, [payload.facturas, rowsByCod]);

  return (
    <>
      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          Nota de crédito Vasos de Duroport — control vivo (facturado × tarifa)
        </h3>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-600">Tarifa USD/caja:</span>
          <input
            type="number" step="0.01" min={0} value={tarifa}
            onChange={(e) => setTarifa(Number(e.target.value) || 0)}
            className="w-20 rounded border border-yellow-300 bg-yellow-50 px-1 py-0.5 text-right tabular-nums"
          />
          <span className="text-slate-600">Promo vigente hasta:</span>
          <input
            type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
            className="rounded border border-yellow-300 bg-yellow-50 px-1 py-0.5"
            title="'le ingresamos la fecha en que se termina y se terminó' (Alexis)"
          />
          <input
            type="text" placeholder="nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)}
            className="w-56 rounded border border-slate-300 px-2 py-0.5"
          />
          <button
            onClick={async () => {
              const e = await postJson('/api/inventarios/reyma/nc-config', {
                tarifaUsd: tarifa, vigenteHasta: hasta || null, nota: nota || undefined,
              });
              if (!e) onSaved();
              flash(e ? `Error: ${e}` : 'Configuración NC guardada ✓');
            }}
            className="inline-flex items-center gap-1 rounded border border-emerald-500 bg-emerald-50 px-3 py-1 font-medium text-emerald-800 hover:bg-emerald-100"
          >
            <Save className="h-3 w-3" /> Guardar
          </button>
          <span className="text-[11px] text-slate-500">
            Vigente: {payload.ncConfig.tarifaUsd} USD/caja
            {payload.ncConfig.vigenteHasta ? ` hasta ${payload.ncConfig.vigenteHasta}` : ' (sin fecha de fin anunciada)'} ·{' '}
            {payload.ncConfig.autor}
          </span>
        </div>
        <div className="mb-2 flex items-center gap-2 text-xs">
          <span className="text-slate-600">Mes (por fecha de factura — el corte es por despacho):</span>
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="rounded border border-slate-300 px-1 py-0.5" />
        </div>
        <table className="text-xs border-collapse min-w-[560px]">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>Código</th>
              <th className={TH}>Descripción</th>
              <th className={THR}>Cajas facturadas</th>
              <th className={THR}>NC USD</th>
              <th className={TH}>Facturas</th>
            </tr>
          </thead>
          <tbody>
            {duroport.map(([cod, v]) => (
              <tr key={cod} className="border-t border-slate-100">
                <td className={`${TD} font-mono`}>{cod}</td>
                <td className={`${TD} max-w-[280px] truncate`} title={v.desc}>{v.desc}</td>
                <td className={TDR}>{qty(v.cajas)}</td>
                <td className={`${TDR} font-medium`}>{fmt(xround(v.cajas * tarifa, 2), 2)}</td>
                <td className={`${TD} text-[10px] text-slate-500`}>{v.facturas.size}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
              <td className={TD} colSpan={2}>TOTAL {mes}</td>
              <td className={TDR}>{qty(totalCajas)}</td>
              <td className={TDR}>{fmt(xround(totalCajas * tarifa, 2), 2)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <div className="mt-2 text-[11px] text-slate-500">
          Contraprueba contra la NC del proveedor al cierre de mes. La OC en Odoo ya va a precio neto (factura −
          tarifa); este control no toca contabilidad.
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          Verificación de precios — factura vs precio vigente ({desviaciones.length} desviaciones &gt;1%)
        </h3>
        <div className="mb-2 text-[11px] text-slate-500">
          «Si no hay nada anunciado, eso no se paga» — anunciado ⇒ se actualiza el precio vigente del producto.
          Algunas facturas traen precios prorrateados/convertidos; revisar antes de reclamar.
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse min-w-[560px]">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Factura</th>
                <th className={TH}>Fecha</th>
                <th className={TH}>Código</th>
                <th className={THR}>Precio factura</th>
                <th className={THR}>Precio vigente</th>
                <th className={THR}>Δ</th>
              </tr>
            </thead>
            <tbody>
              {desviaciones.map((d, i) => (
                <tr key={`${d.factura}-${d.codigo}-${i}`} className="border-t border-slate-100">
                  <td className={`${TD} font-mono text-[10px]`}>{d.factura}</td>
                  <td className={TD}>{d.fecha}</td>
                  <td className={`${TD} font-mono`}>{d.codigo}</td>
                  <td className={TDR}>{d.precio.toLocaleString('es-GT', { maximumFractionDigits: 4 })}</td>
                  <td className={TDR}>{d.base.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</td>
                  <td className={`${TDR} font-semibold ${d.rel > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {(d.rel * 100).toLocaleString('es-GT', { maximumFractionDigits: 1 })}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
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

function TabDatos({
  payload,
  flash,
  onSaved,
}: {
  payload: ReymaVivoPayload;
  flash: (m: string) => void;
  onSaved: () => void;
}) {
  const directas = payload.transitoDetalle.filter((t) => t.esEntregaDirecta);
  const [etaEdits, setEtaEdits] = useState<Record<string, { eta: string; nota: string }>>({});
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
                <th className={TH}>ETA (anotado)</th>
                <th className={TH}>Nota</th>
                <th className={TH}>Tipo</th>
              </tr>
            </thead>
            <tbody>
              {payload.transitoDetalle.map((t, i) => {
                const edit = etaEdits[t.poName] ?? { eta: t.eta ?? '', nota: t.nota ?? '' };
                return (
                <tr key={`${t.poName}-${t.codigo}-${i}`} className="border-t border-slate-100">
                  <td className={`${TD} font-mono text-[10px] max-w-[280px] truncate`} title={t.poName}>
                    {t.poName}
                  </td>
                  <td className={`${TD} font-mono`}>{t.codigo}</td>
                  <td className={TDR}>{qty(t.cantidad)}</td>
                  <td className={TD}>{t.destino ?? '—'}</td>
                  <td className={TD}>
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="date"
                        value={edit.eta}
                        onChange={(e) => setEtaEdits({ ...etaEdits, [t.poName]: { ...edit, eta: e.target.value } })}
                        className="rounded border border-yellow-300 bg-yellow-50 px-1 py-0.5 text-[11px]"
                        title={t.notaAutor ? `Anotado por ${t.notaAutor}` : 'ETA no vive en Odoo — se anota aquí (fila 5 del libro)'}
                      />
                      <button
                        onClick={async () => {
                          const e = await postJson('/api/inventarios/reyma/furgon-nota', {
                            poName: t.poName,
                            eta: edit.eta || null,
                            nota: edit.nota || undefined,
                          });
                          if (!e) onSaved();
                          flash(e ? `Error: ${e}` : `ETA de ${t.poName.split(' ')[0]} guardada ✓`);
                        }}
                        className="text-emerald-600 hover:text-emerald-800"
                        title="Guardar ETA/nota"
                      >
                        <Save className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </td>
                  <td className={TD}>
                    <input
                      type="text"
                      value={edit.nota}
                      placeholder={t.fechaPlaneada ? `PO plan: ${t.fechaPlaneada}` : ''}
                      onChange={(e) => setEtaEdits({ ...etaEdits, [t.poName]: { ...edit, nota: e.target.value } })}
                      className="w-36 rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                    />
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
                );
              })}
              {payload.transitoDetalle.length === 0 && (
                <tr>
                  <td className={TD} colSpan={7}>
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
