'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  calcularModelo,
  type EstadoReorden, type FilaReorden, type ParamsReorden, type ResultadoReorden,
} from '@/lib/inventarios/reorden';

/**
 * Pantalla del modelo de punto de reorden — Darnel y Asia (A4.27).
 *
 * El cálculo corre ACÁ, con el mismo módulo que las pruebas contrastan contra
 * el libro del 20-ago. La API sirve insumos; nadie recalcula del otro lado.
 *
 * DOS COSAS QUE ESTA PANTALLA DICE EN VOZ ALTA en vez de esconder, porque son
 * hallazgos del libro y no defectos nuestros:
 *   · los productos EN LIQUIDACIÓN, que el libro pide por tener rota su regla;
 *   · los parámetros que nadie declaró, que se muestran como «sin definir».
 */

interface Datos {
  modelo: { slug: string; nombre: string; provisional: boolean; notas: string | null;
            mesesPromedio: number | null; moneda: string };
  params: ParamsReorden;
  filas: FilaReorden[];
  transitoDetalle: Record<string, { fecha: string | null; cantidadMl: number;
                                    referencia: string | null }[]>;
  extra: Record<string, { codProveedor: string | null; um: string | null }>;
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

export function ReordenClient({ modelo }: { modelo: string }) {
  const [d, setD] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<EstadoReorden | ''>('');
  const [busqueda, setBusqueda] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/inventarios/reorden?modelo=${encodeURIComponent(modelo)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'No se pudo cargar');
        return j;
      })
      .then(setD)
      .catch((e) => setError(e.message));
  }, [modelo]);

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
