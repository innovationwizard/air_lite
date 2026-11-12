'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ColumnaPorque } from '@/lib/compras/reglasConfig';
import type { MetricasSku } from '@/lib/compras/explicarSku';
import { fmt } from '@/lib/compras/reabastecimientoEngine';

const TITULO: Record<ColumnaPorque, string> = {
  exist: 'Exist. neta',
  patio: 'Patio',
  trans: 'Tránsito',
  pend: 'Pend. reserva',
  doh: 'DOH',
  sug: 'Sugerido',
  abc: 'ABC',
  tend: 'Tendencia',
  mes: 'Mes en curso',
  p6: 'Ord. 6m',
  p3: 'Ord. 3m',
  adic: 'Adicionales',
  pide: 'Pide bodega',
};

export interface FilaPorque {
  cod: string;
  exist: number;
  existencias: number;
  reserved: number;
  patio: number;
  pending: number | null;
  trans: number;
  transOverridden: boolean;
  transitoDetalle: { fecha: string | null; qty: number; orden: string | null }[];
  doh?: number;
  sug?: number;
  abc?: string;
  p6?: number;
  p3?: number;
  h?: number;
  win?: number;
  adic?: number;
  adicComercial?: number;
  sugBodega?: number | null;
  proyeccion?: number;
  mtd?: number | null;
  mtdDias?: number | null;
  mtdRitmo?: number | null;
  tendencia?: { estado: string; meses: { month: string; qty: number }[]; alzaPct: number | null; motivo: string | null };
  divergencia?: { estado: string; pct: number | null; motivo: string | null };
  alerta?: { estado: string; motivo: string | null };
  canales?: { nombre: string; directo: number }[];
}

/** Factors that already produced the figure on the row. The drawer does not recompute it. */
export interface FactoresFila {
  weekdays: number;
  t_divisor: number;
  general_growth: number;
  win_general: number;
  default_dias: number;
  min_qty_for_class: number;
  a_share: number;
  b_share: number;
  mtd_color_high: number;
  mtd_color_low: number;
}

export function PorqueDrawer({
  columna, bodega, etiqueta, fila, coberturaDias, abcFilas, factores, onClose,
}: {
  columna: ColumnaPorque;
  bodega: string;
  etiqueta: string;
  fila: FilaPorque | null;
  /** Horizon already used for this bodega's Sugerido. Not recomputed here. */
  coberturaDias?: number;
  /** Ord. 3m of the bodega, so ABC can name this product's place. */
  abcFilas?: { cod: string; p3: number }[];
  /** Factors from this page load. They explain the figure; they do not replace it. */
  factores?: FactoresFila;
  onClose: () => void;
}) {
  const [resumen, setResumen] = useState<string | null>(null);
  const [parametros, setParametros] = useState<Record<string, number> | null>(null);
  const [vivo, setVivo] = useState<MetricasSku | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let activo = true;
    setCargando(true);
    setParametros(null);
    setVivo(null);
    setError(null);
    const q = new URLSearchParams({ columna, bodega });
    if (fila?.cod) q.set('sku', fila.cod);
    fetch(`/api/compras/reabastecimiento/porque?${q}`)
      .then(async (r) => {
        const cuerpo = await r.json();
        if (!r.ok) throw new Error(cuerpo.error ?? `HTTP ${r.status}`);
        return cuerpo as {
          resumen: string; parametros?: Record<string, number> | null;
          vivo: MetricasSku | null; error: string | null;
        };
      })
      .then((cuerpo) => {
        if (!activo) return;
        setResumen(cuerpo.resumen);
        setParametros(cuerpo.parametros ?? null);
        setVivo(cuerpo.vivo);
        setError(cuerpo.error);
      })
      .catch((e: unknown) => {
        if (!activo) return;
        setError(e instanceof Error ? e.message : 'No se pudo abrir el detalle');
      })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [columna, bodega, fila?.cod]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/20" aria-label="Cerrar" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{TITULO[columna]}</h2>
            <p className="text-xs text-gray-500">
              {etiqueta}{fila ? ` · ${fila.cod}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Cerrar">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 space-y-4 overflow-auto px-4 py-3 text-sm text-gray-800">
          {cargando && !resumen && <p className="text-gray-500">Leyendo la regla…</p>}
          {resumen && <p>{resumen}</p>}
          {fila && (
            <EnLaTabla
              columna={columna}
              fila={fila}
              parametros={parametros}
              factores={factores}
              coberturaDias={coberturaDias}
              abcFilas={abcFilas}
            />
          )}
          {!fila && <p className="text-xs text-gray-500">Elija un producto en la tabla para ver qué compone su número.</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
          {vivo && fila && <DetalleVivo columna={columna} vivo={vivo} />}
        </div>
      </aside>
    </div>
  );
}

function EnLaTabla({
  columna, fila, parametros, factores, coberturaDias, abcFilas,
}: {
  columna: ColumnaPorque;
  fila: FilaPorque;
  parametros: Record<string, number> | null;
  factores?: FactoresFila;
  coberturaDias?: number;
  abcFilas?: { cod: string; p3: number }[];
}) {
  const calculada = explicacionCalculada(columna, fila, parametros, factores, coberturaDias, abcFilas);
  if (calculada) return calculada;
  if (columna === 'exist') {
    const pend = fila.pending === null ? '¿?' : fmt(fila.pending);
    return (
      <p className="rounded bg-gray-50 px-3 py-2 text-xs">
        En la tabla: {fmt(fila.existencias)} − {fmt(fila.reserved)} − {pend} = <b>{fmt(fila.exist)}</b>
      </p>
    );
  }
  if (columna === 'patio') {
    return <p className="rounded bg-gray-50 px-3 py-2 text-xs">En la tabla: <b>{fmt(fila.patio)}</b></p>;
  }
  if (columna === 'trans') {
    return (
      <div className="rounded bg-gray-50 px-3 py-2 text-xs">
        <p>En la tabla: <b>{fmt(fila.trans)}</b>{fila.transOverridden ? ' (captura manual)' : ''}</p>
        {fila.transitoDetalle.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {fila.transitoDetalle.map((d, i) => (
              <li key={i}>{d.orden ?? 'Sin correlativo'} · {d.fecha ?? 'sin fecha'} · {fmt(d.qty)}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <p className="rounded bg-gray-50 px-3 py-2 text-xs">
      En la tabla: <b>{fila.pending === null ? '¿?' : fmt(fila.pending)}</b>
    </p>
  );
}

function factor(
  key: keyof FactoresFila,
  factores: FactoresFila | undefined,
  parametros: Record<string, number> | null,
  fallback: number,
): number {
  const deLaCarga = factores?.[key];
  if (typeof deLaCarga === 'number' && Number.isFinite(deLaCarga)) return deLaCarga;
  const deLaRegla = parametros?.[key];
  if (typeof deLaRegla === 'number' && Number.isFinite(deLaRegla)) return deLaRegla;
  return fallback;
}

function explicacionCalculada(
  columna: ColumnaPorque,
  fila: FilaPorque,
  parametros: Record<string, number> | null,
  factores: FactoresFila | undefined,
  coberturaDias: number | undefined,
  abcFilas: { cod: string; p3: number }[] | undefined,
) {
  const n = (key: keyof FactoresFila, fallback: number) => factor(key, factores, parametros, fallback);
  if (columna === 'doh' && fila.doh !== undefined && fila.p3 !== undefined) {
    const dias = n('weekdays', 26);
    return (
      <Caja
        titulo={`En la tabla: ${fila.doh.toFixed(1)}`}
        items={[
          `Exist. neta ${fmt(fila.exist)}`,
          `Ord. 3m ${fmt(fila.p3)}`,
          `Días hábiles de la regla: ${dias}`,
          `DOH = exist. neta ÷ (Ord. 3m ÷ ${dias})`,
        ]}
      />
    );
  }
  if (columna === 'sug' && fila.sug !== undefined && fila.p3 !== undefined && fila.p6 !== undefined) {
    const divisor = n('t_divisor', 20);
    const crecimiento = n('general_growth', 1.1);
    const ventanaGeneral = n('win_general', 10);
    const T = (fila.p3 / divisor) * (fila.win ?? 0);
    const U = fila.exist + fila.trans - T;
    const V = U > 0 ? U : 0;
    const dias = coberturaDias ?? n('default_dias', 30);
    const conCrecimiento = fila.win === ventanaGeneral;
    return (
      <Caja
        titulo={`En la tabla: ${fmt(fila.sug)}`}
        items={[
          `Ord. 6m ${fmt(fila.p6)} · Ord. 3m ${fmt(fila.p3)} · estacional ${fmt(fila.h ?? 0)}`,
          `Ventana ${fila.win ?? '—'} · ${conCrecimiento
            ? `el pronóstico parte de ((Ord. 6m + Ord. 3m + estacional) ÷ 3) × ${crecimiento}`
            : 'el pronóstico parte del promedio de Ord. 6m y Ord. 3m'}`,
          `Cobertura de esta bodega: ${dias} días (el default de la regla es ${n('default_dias', 30)})`,
          fila.proyeccion !== undefined ? `Pronóstico que usa la fila: ${fmt(fila.proyeccion)}` : '',
          `T = (Ord. 3m ÷ ${divisor}) × ventana = ${fmt(T)}`,
          `Exist. neta ${fmt(fila.exist)} + tránsito ${fmt(fila.trans)} − T → V = ${fmt(V)}`,
          `Adicionales ${fmt(fila.adic ?? 0)}`,
        ].filter(Boolean)}
      />
    );
  }
  if (columna === 'abc' && fila.abc && fila.p3 !== undefined) {
    const floor = n('min_qty_for_class', 10);
    const puesto = puestoAbc(fila, abcFilas ?? [], floor, n('a_share', 0.5), n('b_share', 0.8));
    return (
      <Caja
        titulo={`En la tabla: ${fila.abc}`}
        items={[
          `Ord. 3m ${fmt(fila.p3)}`,
          ...puesto,
        ]}
      />
    );
  }
  if (columna === 'tend' && fila.tendencia) {
    const t = fila.tendencia;
    const meses = t.meses.map((m) => `${m.month}: ${fmt(m.qty)}`).join(' → ');
    const div = fila.divergencia;
    return (
      <Caja
        titulo={`En la tabla: ${t.estado}`}
        items={[
          meses || (t.motivo ?? 'Sin meses evaluados'),
          t.alzaPct === null ? '' : `Alza del primero al último: ${t.alzaPct.toFixed(0)}%`,
          div ? `Divergencia: ${div.estado}${div.pct === null ? '' : ` (${(div.pct * 100).toFixed(0)}%)`}` : '',
          div?.motivo ?? '',
          fila.alerta ? `Alerta en la tabla: ${fila.alerta.estado}${fila.alerta.motivo ? ` — ${fila.alerta.motivo}` : ''}` : '',
        ].filter(Boolean)}
      />
    );
  }
  if (columna === 'mes') {
    if (fila.mtd === null || fila.mtd === undefined || fila.mtdDias === null || fila.mtdDias === undefined) {
      return <Caja titulo="En la tabla: —" items={['Esta fila todavía no tiene venta del mes.']} />;
    }
    return (
      <Caja
        titulo={`En la tabla: ${fmt(fila.mtd)} / ${fila.mtdDias}d`}
        items={[
          `Ordenado en el mes: ${fmt(fila.mtd)}`,
          `Días transcurridos: ${fila.mtdDias}`,
          fila.mtdRitmo === null || fila.mtdRitmo === undefined ? '' : `Ritmo a 30 días: ${fmt(fila.mtdRitmo)}`,
          `Ord. 3m: ${fmt(fila.p3 ?? 0)}`,
          `Umbral alto: ${n('mtd_color_high', 1.15)} × Ord. 3m`,
          `Umbral bajo: ${n('mtd_color_low', 0.85)} × Ord. 3m`,
          colorMes(fila, n('mtd_color_high', 1.15), n('mtd_color_low', 0.85)),
        ].filter(Boolean)}
      />
    );
  }
  if (columna === 'p6' && fila.p6 !== undefined) {
    return <Caja titulo={`En la tabla: ${fmt(fila.p6)}`} items={['Promedio mensual de lo ordenado en 6 meses completos.']} />;
  }
  if (columna === 'p3' && fila.p3 !== undefined) {
    return <Caja titulo={`En la tabla: ${fmt(fila.p3)}`} items={['Promedio mensual de lo ordenado en 3 meses completos.']} />;
  }
  if (columna === 'adic' && fila.adic !== undefined) {
    return (
      <Caja
        titulo={`En la tabla: ${fmt(fila.adic)}`}
        items={[
          `Compra extraordinaria de los canales: ${fmt(fila.adicComercial ?? 0)}`,
          ...(fila.canales ?? []).map((c) => `${c.nombre}: ${fmt(c.directo)}`),
          `Pide bodega: ${fila.sugBodega === null || fila.sugBodega === undefined ? '0' : fmt(fila.sugBodega)}`,
          'La suma de esas dos es Adicionales.',
        ]}
      />
    );
  }
  if (columna === 'pide') {
    const pedido = fila.sugBodega;
    return (
      <Caja
        titulo={`En la tabla: ${pedido === null || pedido === undefined ? '—' : fmt(pedido)}`}
        items={['Se suma a la compra extraordinaria de los canales para formar Adicionales.']}
      />
    );
  }
  return null;
}

function colorMes(fila: FilaPorque, high: number, low: number): string {
  if (fila.mtdRitmo === null || fila.mtdRitmo === undefined || !fila.p3) return '';
  if (fila.mtdRitmo > fila.p3 * high) return 'El ritmo pasa el umbral alto: la celda se marca alto.';
  if (fila.mtdRitmo < fila.p3 * low) return 'El ritmo queda bajo el umbral bajo: la celda se marca bajo.';
  return 'El ritmo queda entre los dos umbrales.';
}

function puestoAbc(
  fila: FilaPorque,
  todas: { cod: string; p3: number }[],
  floor: number,
  aShare: number,
  bShare: number,
): string[] {
  if ((fila.p3 ?? 0) < floor) {
    return [`Ord. 3m está por debajo de ${floor}, el piso de la regla. La clase es D.`];
  }
  const resto = todas.filter((r) => r.p3 >= floor).sort((a, b) => b.p3 - a.p3);
  const total = resto.reduce((sum, r) => sum + r.p3, 0);
  let acumulado = 0;
  for (let i = 0; i < resto.length; i += 1) {
    acumulado += resto[i].p3;
    if (resto[i].cod !== fila.cod) continue;
    const pct = total === 0 ? 0 : acumulado / total;
    const corte = pct <= aShare ? 'A' : pct <= bShare ? 'B' : 'C';
    return [
      `Puesto ${i + 1} de ${resto.length} con Ord. 3m de al menos ${floor}.`,
      `Acumulado ${Math.round(pct * 100)}% del ordenado de ese grupo.`,
      `Con los cortes ${Math.round(aShare * 100)}% / ${Math.round(bShare * 100)}% eso es ${corte}. La tabla muestra ${fila.abc}.`,
    ];
  }
  return ['Este código quedó fuera del grupo que clasifica en esta bodega.'];
}

function Caja({ titulo, items }: { titulo: string; items: string[] }) {
  return (
    <div className="rounded bg-gray-50 px-3 py-2 text-xs">
      <p className="font-semibold text-gray-800">{titulo}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  );
}

function DetalleVivo({ columna, vivo }: { columna: ColumnaPorque; vivo: MetricasSku }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Lectura en vivo con esta regla</p>
      {columna === 'exist' && (
        vivo.ubicaciones.length === 0
          ? <p className="mt-1 text-xs text-gray-500">Ninguna ubicación con cantidad para este SKU.</p>
          : <Lista items={vivo.ubicaciones.map((u) => `${u.ubicacion}: ${fmt(u.cantidad)} (reservado ${fmt(u.reservado ?? 0)})`)} />
      )}
      {columna === 'patio' && (
        vivo.patioUbicaciones.length === 0
          ? <p className="mt-1 text-xs text-gray-500">Esta bodega no muestra patio, o la ubicación no tiene cantidad.</p>
          : <Lista items={vivo.patioUbicaciones.map((u) => `${u.ubicacion}: ${fmt(u.cantidad)}`)} />
      )}
      {columna === 'trans' && (
        vivo.ordenes.length === 0
          ? <p className="mt-1 text-xs text-gray-500">Ninguna orden entra con la regla actual.</p>
          : <Lista items={vivo.ordenes.map((o) => `${o.orden ?? 'Sin correlativo'} · ${o.fecha ?? 'sin fecha'} · ${fmt(o.cantidad)}`)} />
      )}
      {columna === 'pend' && (
        <>
          {vivo.movimientos.length === 0
            ? <p className="mt-1 text-xs text-gray-500">Ningún movimiento abierto sale de las existencias.</p>
            : <Lista items={vivo.movimientos.map((m) => `${m.referencia || 'Sin referencia'} · ${m.origen} · demanda ${fmt(m.demanda)} − ${fmt(m.cantidad)} = ${fmt(m.pendiente)}`)} />}
          {vivo.movimientosRecortados && <p className="mt-1 text-xs text-gray-500">Se muestran los primeros movimientos. El total usa todos.</p>}
          {vivo.uomSinConvertir > 0 && <p className="mt-1 text-xs text-amber-800">{vivo.uomSinConvertir} movimientos no se pudieron pasar a la unidad de stock y se sumaron tal cual.</p>}
        </>
      )}
    </div>
  );
}

function Lista({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 space-y-1 text-xs">
      {items.map((item, i) => <li key={i} className="border-b border-gray-100 py-1">{item}</li>)}
    </ul>
  );
}
