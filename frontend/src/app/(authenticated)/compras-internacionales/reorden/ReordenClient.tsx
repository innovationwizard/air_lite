'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Save, Truck } from 'lucide-react';
import {
  calcularModelo,
  type EstadoReorden, type FilaReorden, type ParamsReorden, type ResultadoReorden,
} from '@/lib/compras-internacionales/reorden';
import {
  capacidadContenedor,
  lineasDeSugerido,
  payloadPlan,
  proyectarFurgones,
  type FurgonVista,
  type PayloadPlanReorden,
} from '@/lib/compras-internacionales/reordenPlan';
import { packLines } from '../reyma-vivo/packLines';

/**
 * Pantalla del modelo de punto de reorden — Darnel y Asia (A4.27).
 *
 * El cálculo corre ACÁ, con el mismo módulo que las pruebas contrastan contra
 * el libro del 20-ago. La API sirve insumos; nadie recalcula del otro lado.
 * El plan de furgones también se arma acá: `packLines` reparte la columna
 * Pedir (millares) con el m³ por millar, en la capacidad del contenedor.
 *
 * DOS COSAS QUE ESTA PANTALLA DICE EN VOZ ALTA en vez de esconder, porque son
 * hallazgos del libro y no defectos nuestros:
 *   · los productos EN LIQUIDACIÓN, que el libro pide por tener rota su regla;
 *   · los parámetros que nadie declaró, que se muestran como «sin definir».
 */

interface UltimoPlan {
  autor: string;
  fecha: string;
  capacidadM3: number;
}

interface Datos {
  modelo: { slug: string; nombre: string; provisional: boolean; notas: string | null;
            mesesPromedio: number | null; moneda: string };
  params: ParamsReorden;
  filas: FilaReorden[];
  transitoDetalle: Record<string, { fecha: string | null; cantidadMl: number;
                                    referencia: string | null }[]>;
  extra: Record<string, { codProveedor: string | null; um: string | null }>;
  ultimoPlan: UltimoPlan | null;
}

const ORDEN_ESTADO: EstadoReorden[] = [
  'CRITICO', 'REORDENAR', 'OK', 'EXCESO', 'SIN MOVIMIENTO',
  'EN LIQUIDACION', 'SIN CONVERSION',
];

const PILL: Record<EstadoReorden, string> = {
  CRITICO: 'bg-red-50 text-red-800 border-red-200',
  REORDENAR: 'bg-amber-50 text-amber-800 border-amber-200',
  OK: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  EXCESO: 'bg-sky-50 text-sky-800 border-sky-200',
  'SIN MOVIMIENTO': 'bg-gray-50 text-gray-600 border-gray-200',
  'EN LIQUIDACION': 'bg-purple-50 text-purple-800 border-purple-200',
  'SIN CONVERSION': 'bg-orange-50 text-orange-800 border-orange-200',
};

const AYUDA: Record<EstadoReorden, string> = {
  CRITICO: 'Cobertura total menor a 7 semanas. Urgente.',
  REORDENAR: 'Cobertura menor a 10.7 semanas. Toca colocar pedido.',
  OK: 'Entre el punto de reorden y el máximo.',
  EXCESO: 'Cobertura por encima del 150% del máximo.',
  'SIN MOVIMIENTO': 'Sin venta proyectada. La cobertura es infinita, no cero.',
  'EN LIQUIDACION': 'Producto descontinuado. No se pide más.',
  'SIN CONVERSION': 'Sin unidades por fardo: no se puede convertir a millares.',
};

const n1 = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v.toLocaleString('es-GT', { maximumFractionDigits: 1 });
const n0 = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v.toLocaleString('es-GT', { maximumFractionDigits: 0 });
const nMl = (v: number) => v.toLocaleString('es-GT', { maximumFractionDigits: 3 });
const nM3 = (v: number) => v.toLocaleString('es-GT', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function ReordenClient({ modelo, soloLectura = false }: {
  modelo: string;
  soloLectura?: boolean;
}) {
  const [d, setD] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<EstadoReorden | ''>('');
  const [busqueda, setBusqueda] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);

  const cargar = useCallback(async (conservar: boolean) => {
    try {
      const r = await fetch(`/api/compras-internacionales/reorden?modelo=${encodeURIComponent(modelo)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo cargar');
      setD(j as Datos);
      setError(null);
    } catch (e) {
      if (!conservar) setError(e instanceof Error ? e.message : 'No se pudo cargar');
      else throw e;
    }
  }, [modelo]);

  useEffect(() => {
    void cargar(false);
  }, [cargar]);

  const resultado = useMemo(
    () => (d ? calcularModelo(d.filas, d.params) : null), [d]);

  if (error) return <div className="p-8 text-sm text-red-700">{error}</div>;
  if (!d || !resultado) return <div className="p-8 text-sm text-gray-500">Cargando…</div>;

  const porEstado = ORDEN_ESTADO.map((e) => ({
    estado: e, n: resultado.filas.filter((f) => f.estado === e).length,
  })).filter((x) => x.n > 0);

  const visibles = resultado.filas.filter((f) => {
    if (filtro && f.estado !== filtro) return false;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      if (!`${f.codigo} ${f.descripcion ?? ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const enLiquidacionQueElLibroPide = resultado.filas.filter(
    (f) => f.estado === 'EN LIQUIDACION').length;
  const cap = capacidadContenedor(d.params.capacidadContenedorM3);

  return (
    <div className="max-w-[1500px] mx-auto px-4 sm:px-6 py-6 space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {d.modelo.nombre} — punto de reorden
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Stock de seguridad + lead time + alcance máximo. La venta es la columna
            vertebral; el pedido es la diferencia contra el máximo.
          </p>
        </div>
        {d.modelo.provisional && (
          <span className="text-xs px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-800">
            Modelo provisional
          </span>
        )}
      </header>

      {cap === null && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          <strong>{d.modelo.nombre}</strong> no tiene capacidad de contenedor
          (<span className="font-mono">modelo_proveedor.capacidad_contenedor_m3</span> está vacía). El plan de
          despacho no se arma hasta que se cargue la capacidad de este modelo.
        </div>
      )}

      {/* Parámetros — los que faltan se ven, no se sustituyen */}
      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <Param label="Stock de seguridad" v={d.params.semanasSeguridad} u="sem" />
          <Param label="Lead time" v={d.params.semanasLeadTime} u="sem" />
          <Param label="Punto de reorden" v={d.params.semanasReorden} u="sem" />
          <Param label="Inv. máximo (base)" v={d.params.semanasInvMaximoBase} u="sem" />
          <Param label="Contenedor" v={d.params.capacidadContenedorM3} u="m³" />
          <Param label="Semanas por contenedor" v={resultado.semanasPorContenedorGlobal} u="sem" />
          <div>
            <span className="block text-xs text-gray-500">Inv. máximo aplicado</span>
            <span className="font-medium text-gray-900">
              {n1(resultado.semanasInvMaximo)} sem
            </span>
          </div>
        </div>

        {resultado.parametrosFaltantes.length > 0 && (
          <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
            <strong>Sin definir:</strong> {resultado.parametrosFaltantes.join(' · ')}. No se
            heredan de otro proveedor — mientras falten, este modelo no propone pedido.
          </p>
        )}

        {/* La inconsistencia del propio libro, dicha en vez de corregida. */}
        {d.params.semanasSeguridad !== null && d.params.semanasLeadTime !== null
          && d.params.semanasReorden !== null
          && d.params.semanasSeguridad + d.params.semanasLeadTime !== d.params.semanasReorden && (
          <p className="mt-2 text-xs text-gray-600">
            ⚠️ El libro define el punto de reorden como «seguridad + lead time»
            ({d.params.semanasSeguridad} + {d.params.semanasLeadTime} ={' '}
            {d.params.semanasSeguridad + d.params.semanasLeadTime}) pero usa{' '}
            <strong>{d.params.semanasReorden}</strong>. Se respeta el valor que el libro
            aplica; la diferencia mueve qué productos entran a «reordenar».
          </p>
        )}
      </section>

      <PlanFurgones
        key={d.modelo.slug}
        nombre={d.modelo.nombre}
        slug={d.modelo.slug}
        cap={cap}
        filas={resultado.filas}
        inventario={d.filas}
        soloLectura={soloLectura}
        ultimo={d.ultimoPlan ?? null}
        recargar={() => cargar(true)}
      />

      {/* Semáforo */}
      <section className="flex flex-wrap gap-2">
        <button
          onClick={() => setFiltro('')}
          className={`px-3 py-1.5 text-sm rounded-md border ${
            filtro === '' ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-700 border-gray-300'}`}
        >
          Todos · {resultado.filas.length}
        </button>
        {porEstado.map(({ estado, n }) => (
          <button
            key={estado}
            onClick={() => setFiltro(filtro === estado ? '' : estado)}
            title={AYUDA[estado]}
            className={`px-3 py-1.5 text-sm rounded-md border ${PILL[estado]} ${
              filtro === estado ? 'ring-2 ring-gray-900' : ''}`}
          >
            {estado} · {n}
          </button>
        ))}
      </section>

      {enLiquidacionQueElLibroPide > 0 && (
        <p className="text-xs text-purple-900 bg-purple-50 border border-purple-200 rounded-lg p-3">
          <strong>{enLiquidacionQueElLibroPide} productos en liquidación no proponen
          pedido.</strong> En el libro esta regla está rota —consulta un rango
          inexistente que Excel se traga en silencio— así que allí estos productos
          <em> sí</em> aparecen con cantidad a pedir. El dato bueno está en la hoja de
          precios y es el que se usa acá.
        </p>
      )}

      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex gap-6 text-sm">
            <span className="text-gray-500">
              A pedir: <strong className="text-gray-900">{n1(resultado.totales.pedirMl)}</strong> ML
            </span>
            <span className="text-gray-500">
              Valor: <strong className="text-gray-900">
                {resultado.totales.valorUsd.toLocaleString('es-GT', {
                  style: 'currency', currency: d.modelo.moneda, maximumFractionDigits: 0 })}
              </strong>
            </span>
            {resultado.totales.sinConversion > 0 && (
              <span className="text-orange-700">
                {resultado.totales.sinConversion} sin conversión
              </span>
            )}
          </div>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar código o descripción…"
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md w-64"
          />
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-right text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3 text-left font-medium">Código</th>
                <th className="py-2 pr-3 text-left font-medium">Descripción</th>
                <th className="py-2 pr-3 font-medium" title="Bodegas + patios − pendientes por surtir">
                  Inv. neto
                </th>
                <th className="py-2 pr-3 font-medium" title="En aguas, con fecha de llegada">Tráns. conf.</th>
                <th className="py-2 pr-3 font-medium" title="Pedido en fábrica, sin despachar">Tráns. pend.</th>
                <th className="py-2 pr-3 font-medium">Inv. total</th>
                <th className="py-2 pr-3 font-medium">Venta/sem</th>
                <th className="py-2 pr-3 font-medium" title="Semanas de cobertura contando el tránsito">Cob.</th>
                <th className="py-2 pr-3 font-medium">Máximo</th>
                <th className="py-2 pr-3 font-medium">Pedir</th>
                <th className="py-2 pr-3 text-left font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const det = d.transitoDetalle[f.codigo] ?? [];
                return (
                  <FilaTabla
                    key={f.codigo} f={f} detalle={det}
                    abierta={abierta === f.codigo}
                    onToggle={() => setAbierta(abierta === f.codigo ? null : f.codigo)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        {visibles.length === 0 && (
          <p className="text-sm text-gray-500 mt-4">Nada que mostrar con ese filtro.</p>
        )}
      </section>
    </div>
  );
}

function Param({ label, v, u }: { label: string; v: number | null; u: string }) {
  return (
    <div>
      <span className="block text-xs text-gray-500">{label}</span>
      {v === null
        ? <span className="text-amber-700">sin definir</span>
        : <span className="font-medium text-gray-900">{n1(v)} {u}</span>}
    </div>
  );
}

function FilaTabla({ f, detalle, abierta, onToggle }: {
  f: ResultadoReorden;
  detalle: { fecha: string | null; cantidadMl: number; referencia: string | null }[];
  abierta: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className={`border-b border-gray-100 text-right ${
        f.estado === 'CRITICO' ? 'bg-red-50/40' : ''}`}>
        <td className="py-2 pr-3 text-left font-mono text-xs text-gray-500">{f.codigo}</td>
        <td className="py-2 pr-3 text-left text-gray-800 max-w-[280px] truncate"
            title={f.descripcion ?? ''}>{f.descripcion}</td>
        <td className="py-2 pr-3 text-gray-700">{n1(f.invNetoMl)}</td>
        <td className="py-2 pr-3">
          {detalle.length > 0 ? (
            <button onClick={onToggle} className="text-sky-700 hover:underline"
                    title={`${detalle.length} embarque(s)`}>
              {n1(f.transitoConfirmado)}
            </button>
          ) : <span className="text-gray-400">—</span>}
        </td>
        <td className="py-2 pr-3 text-gray-500">
          {f.transitoPendiente ? n1(f.transitoPendiente) : '—'}
        </td>
        <td className="py-2 pr-3 font-medium text-gray-900">{n1(f.invTotalMl)}</td>
        <td className="py-2 pr-3 text-gray-600">{n1(f.ventaSemanal)}</td>
        <td className="py-2 pr-3 text-gray-700">
          {f.coberturaTotal === null ? '∞' : `${n1(f.coberturaTotal)} sem`}
        </td>
        <td className="py-2 pr-3 text-gray-500">{n1(f.invMaximoMl)}</td>
        <td className={`py-2 pr-3 font-bold ${f.pedirMl > 0 ? 'text-teal-700' : 'text-gray-300'}`}>
          {f.pedirMl > 0 ? n0(f.pedirMl) : '—'}
        </td>
        <td className="py-2 pr-3 text-left">
          <span className={`text-[11px] px-1.5 py-0.5 rounded border ${PILL[f.estado]}`}
                title={f.motivo ?? AYUDA[f.estado]}>
            {f.estado}
          </span>
        </td>
      </tr>
      {abierta && detalle.length > 0 && (
        <tr className="bg-sky-50/40">
          <td colSpan={11} className="px-3 py-2 text-xs text-gray-600">
            <strong>Embarques confirmados:</strong>{' '}
            {detalle.map((t, i) => (
              <span key={i} className="mr-4">
                {n1(t.cantidadMl)} ML —{' '}
                {t.fecha
                  ? new Date(`${t.fecha}T00:00:00`).toLocaleDateString('es-GT',
                      { day: 'numeric', month: 'short', timeZone: 'UTC' })
                  : 'sin fecha'}
                {t.referencia && <span className="text-gray-400"> ({t.referencia})</span>}
              </span>
            ))}
          </td>
        </tr>
      )}
    </>
  );
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

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-GT');
}

/**
 * Arma y muestra el plan de furgones. La cantidad es la columna Pedir
 * (millares) y el cubicaje es el m³ por millar del mismo inventario.
 * `packLines` reparte eso en la capacidad del contenedor del modelo.
 */
function PlanFurgones({
  nombre, slug, cap, filas, inventario, soloLectura, ultimo, recargar,
}: {
  nombre: string;
  slug: string;
  cap: number | null;
  filas: ResultadoReorden[];
  inventario: FilaReorden[];
  soloLectura: boolean;
  ultimo: UltimoPlan | null;
  recargar: () => Promise<void>;
}) {
  const [furgones, setFurgones] = useState<FurgonVista[] | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [guardado, setGuardado] = useState<PayloadPlanReorden | null>(null);
  const [capUsado, setCapUsado] = useState<number | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const puedeGenerar = cap !== null;

  const generar = () => {
    if (cap === null) {
      setFurgones(null);
      setGuardado(null);
      setCapUsado(null);
      setAvisos([]);
      return;
    }
    const cub = new Map(inventario.map((f) => [f.codigo, f.cubMillar]));
    const built = lineasDeSugerido(filas.map((f) => ({
      codigo: f.codigo,
      descripcion: f.descripcion,
      pedirMl: f.pedirMl,
      coberturaTotal: f.coberturaTotal,
      cubMillar: cub.get(f.codigo) ?? null,
    })), cap);
    try {
      const packed = packLines(built.lines, cap);
      setFurgones(proyectarFurgones(packed, built.meta));
      setGuardado(payloadPlan(cap, packed, built.meta));
      setCapUsado(cap);
      setAvisos(built.avisos);
      setSaveMsg(null);
    } catch (e) {
      setFurgones(null);
      setGuardado(null);
      setCapUsado(null);
      setAvisos([e instanceof Error ? e.message : 'No se pudo armar el plan']);
    }
  };

  const guardar = async () => {
    if (!guardado || soloLectura) return;
    setGuardando(true);
    try {
      const err = await postJson('/api/compras-internacionales/reorden/plan', {
        modelo: slug,
        payload: guardado,
      });
      if (err) {
        setSaveMsg(`Error al guardar plan: ${err}`);
        return;
      }
      try {
        await recargar();
        setSaveMsg('Plan guardado');
      } catch (e) {
        setSaveMsg(e instanceof Error
          ? `Plan guardado. No se actualizó el sello: ${e.message}`
          : 'Plan guardado');
      }
    } finally {
      setGuardando(false);
    }
  };

  const totalMl = furgones?.reduce((a, f) => a + f.totalMl, 0) ?? 0;
  const totalM3 = furgones?.reduce((a, f) => a + f.totalM3, 0) ?? 0;
  const capTarjeta = capUsado ?? cap;

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
        <Truck className="h-4 w-4" />
        Plan de furgones ({puedeGenerar ? `contenedor de ${n1(cap)} m³` : 'capacidad de contenedor sin definir'})
      </h2>
      <p className="text-xs text-slate-500 mb-3">
        Usa las cantidades sugeridas de esta pantalla, en millares, y el m³ por millar
        de cada producto. Entran todos los que tienen pedido, no sólo los del filtro.
        Menor cobertura va primero.
      </p>
      <div className="flex flex-wrap items-center gap-3 text-xs mb-3">
        <button
          type="button"
          onClick={generar}
          disabled={!puedeGenerar || guardando}
          title={puedeGenerar ? undefined : 'Falta la capacidad del contenedor'}
          className={`rounded px-3 py-1 font-medium text-white ${
            puedeGenerar && !guardando
              ? 'bg-emerald-600 hover:bg-emerald-700'
              : 'cursor-not-allowed bg-slate-300'
          }`}
        >
          Generar plan
        </button>
        {guardado && !soloLectura && (
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando}
            className="inline-flex items-center gap-1 rounded border border-emerald-500 bg-emerald-50 px-3 py-1 font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
          >
            <Save className="h-3 w-3" /> {guardando ? 'Guardando…' : 'Guardar plan'}
          </button>
        )}
        {saveMsg && (
          <span className={`font-medium ${saveMsg.startsWith('Error') ? 'text-red-700' : 'text-emerald-700'}`}>
            {saveMsg}
          </span>
        )}
        {ultimo && (
          <span className="text-[11px] text-slate-500">
            Último guardado: {fechaCorta(ultimo.fecha)} por {ultimo.autor} ({n1(ultimo.capacidadM3)} m³)
          </span>
        )}
      </div>
      {cap === null && (
        <div className="mb-2 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {nombre} no tiene capacidad de contenedor. El plan queda detenido hasta
          cargarla en modelo_proveedor.
        </div>
      )}
      {avisos.map((a) => (
        <div key={a} className="mb-2 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a}
        </div>
      ))}
      {furgones && furgones.length > 0 && (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {furgones.length === 1 ? '1 furgón' : `${furgones.length} furgones`}
            {' · '}{nMl(totalMl)} ML{' · '}{nM3(totalM3)} m³
          </p>
          <div className="grid gap-3 lg:grid-cols-3">
            {furgones.map((f) => (
              <div key={f.no} className="rounded border border-slate-200">
                <div className="border-b bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                  Furgón {f.no}
                </div>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-[10px] text-slate-500">
                      <th className="px-2 py-1 text-left font-medium">Código</th>
                      <th className="px-2 py-1 text-left font-medium">Descripción</th>
                      <th className="px-2 py-1 text-right font-medium">ML</th>
                      <th className="px-2 py-1 text-right font-medium">m³</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.lineas.map((l, i) => (
                      <tr key={`${f.no}-${l.codigo}-${i}`} className="border-t border-slate-100">
                        <td className="px-2 py-1 font-mono whitespace-nowrap">{l.codigo}</td>
                        <td className="px-2 py-1 max-w-[160px] truncate" title={l.descripcion}>
                          {l.descripcion || '—'}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{nMl(l.cantidadMl)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{nM3(l.m3)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                      <td className="px-2 py-1" colSpan={2}>Total</td>
                      <td className="px-2 py-1 text-right tabular-nums">{nMl(f.totalMl)}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${
                        capTarjeta != null && f.totalM3 > capTarjeta + 1e-6 ? 'text-red-600' : ''
                      }`}>
                        {nM3(f.totalM3)}
                        {capTarjeta != null ? ` (${n1((f.totalM3 / capTarjeta) * 100)}%)` : ''}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}
      {furgones && furgones.length === 0 && (
        <p className="text-[11px] text-slate-500">
          No hay cantidades sugeridas con cubicaje para armar un furgón.
        </p>
      )}
      {!furgones && (
        <p className="text-[11px] text-slate-500">
          {puedeGenerar
            ? `Genera el plan a partir del pedido sugerido: prioriza menor cobertura y llena furgones de ${n1(cap)} m³.`
            : `El plan no se arma: ${nombre} no tiene capacidad de contenedor cargada.`}
        </p>
      )}
    </section>
  );
}
