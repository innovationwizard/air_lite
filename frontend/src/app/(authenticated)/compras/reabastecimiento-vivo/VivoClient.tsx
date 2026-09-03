'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Boxes, ChevronDown, ChevronUp, ChevronsUpDown, CloudOff, ListFilter, PackageCheck,
  Pencil, RefreshCw, Search, TrendingUp, X,
} from 'lucide-react';
import { MAX_MANUAL_QTY } from '@/lib/compras/qty';
import { type Tendencia, type Alerta, SIN_REFERENCIA_ANIO_ANTERIOR } from '@/lib/compras/tendencia';
import { tablaATsv } from '@/lib/compras/tabla';
import {
  type ClaveOrden, type ClaveOrdenNumerica, type FiltroRango, type OperadorRango,
  type Orden, siguienteOrden, vista,
} from '@/lib/compras/tabla';
import { computeKpis, computeAlza, computeTopProveedores } from '@/lib/compras/statusMetrics';
import { ExportCarvajal } from './ExportCarvajal';
import { SnapshotButton } from './SnapshotButton';
import { ProveedorFiltro, type ProveedorGrupo } from './ProveedorFiltro';
import { ProveedorGruposPanel } from './ProveedorGruposPanel';
import { useUserRole } from '@/lib/auth/useUserRole';
import { CAN_MANAGE_SUPPLIER_GROUPS, isAuthorized } from '@/lib/auth/roles';
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

const ABC_PILL: Record<ApiRow['abc'], string> = {
  A: 'bg-emerald-100 text-emerald-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-amber-100 text-amber-700',
  D: 'bg-gray-100 text-gray-500',
};

/**
 * Tooltips state what each title INCLUDES and EXCLUDES, verbatim from the
 * synced composition — so any disagreement with Wilmer's mental model surfaces
 * as a bug report instead of a silent mismatch (Jorge, 2026-08-11).
 */
const BODEGA_TIP: Record<string, string> = {
  General:
    'Existencias de TODAS las bodegas físicas (incluye tiendas y Zona 11), MENOS 5DEP (reempaque). '
    + 'NO incluye Entrada/patio ni tránsito (regla Wilmer 2026-08-06).',
  'San Jose VN':
    'Existencias de 1CET/Existencias (Bodega Central) únicamente. '
    + 'No incluye tiendas, Zona 11, ni Entrada/patio (el patio se muestra aparte).',
  // Separadas el 2026-08-21 (W11): antes eran una sola bodega 'Zacapa-Petén'.
  // Wilmer: "Zacapa me debe de dar la venta de ambos, pero separada y sumada" —
  // acá va la parte SEPARADA; el total de las dos todavía no tiene vista propia.
  Zacapa:
    'Existencias de 4ZAC/Existencias (Zacapa) únicamente. No incluye Entrada/patio. '
    + '⚠️ Zacapa abastece a Petén, así que parte de esta existencia va de paso — '
    + 'no toda es demanda de Zacapa.',
  'Petén':
    'Existencias de 3PET/Existencias (Petén) únicamente. No incluye Entrada/patio. '
    + 'Petén se abastece DESDE Zacapa, no directamente de San José.',
};

const COL_TIP = {
  sugBodega:
    'Lo que el encargado del centro de distribución pidió ADEMÁS, para esta bodega. '
    + 'Se SUMA al Sugerido: no lo reemplaza, porque es un pedido adicional y no una '
    + 'corrección de la proyección. Vaciar la casilla quita la captura.',
  cod: 'Código del producto (SKU) — identidad estable desde SAE, igual que en Odoo.',
  desc: 'Descripción y proveedor del catálogo de Odoo.',
  abc:
    'Clasificación ABC de esta bodega, sobre Ord. 3m (Wilmer): '
    + 'A = acumula el primer 50% del ordenado · B = siguiente 30% · C = siguiente 15% (y la cola). '
    + 'D = menos de 10 unidades ordenadas en 3 meses, sin importar el ranking.',
  exist:
    'Existencias − reservado − pendiente de tomar reserva (captura manual). '
    + 'NO incluye patio ni tránsito.',
  patio:
    'Solo 1CET/Entrada: furgones en el patio de Bodega Central. '
    + 'Se muestra aparte y NO entra al cálculo (igual que en el Excel).',
  doh:
    'Días de inventario: exist. neta ÷ (promedio 3 meses ÷ 26). '
    + 'Venta = ordenado (excluye cotización, cotización enviada y cancelado). '
    + 'Semáforo aprobado 2026-08-06: crítico < 3 · bajo < 7 · normal 7–30 · exceso > 30.',
  trans:
    'Órdenes de compra confirmadas con fecha de entrega FUTURA (fechas pasadas no cuentan). '
    + 'Editable: tu valor manual reemplaza al sincronizado (p. ej. el mensual de Carvajal). '
    + 'El botón ✕ quita tu captura y vuelve al valor sincronizado.',
  pend:
    'Pendiente de tomar reserva — captura manual (no existe en ningún sistema). '
    + '¿? significa sin dato, no cero. Resta de la exist. neta. '
    + 'El botón ✕ quita la captura y vuelve a ¿? (sin dato).',
  adic: 'Adicional comercial del mes vigente (forecast comercial).',
  ord: 'ORDENADO — la base de Wilmer y la ÚNICA que alimenta el Sugerido. '
    + 'Promedio mensual de cantidad ordenada (sale.order.line, estados venta y hecho; '
    + 'excluye cotización, cotización enviada y cancelado), por bodega de la orden.',
  fact: 'FACTURADO — la base de Raquel/contabilidad, SOLO informativa: no toca el Sugerido. '
    + 'Filtro de ella (2026-07-28): facturas publicadas, ni borrador ni canceladas, '
    + 'cuentas de INGRESO (nunca bancos, circular ni gastos); las notas de crédito restan. '
    + 'Por bodega = diario del CD correspondiente. En General = todos los diarios, '
    + 'igual que Ordenado General es todas las bodegas.',
  mes: 'Venta ORDENADA del mes en curso (parcial) y el ritmo que implica para 30 días. '
    + 'Es la comparación que pidió Wilmer el 2026-08-20: la venta del mes contra el promedio. '
    + 'Los promedios de 6 y 3 meses van por detrás cuando la demanda se mueve; esta columna '
    + 'muestra lo que ellos todavía no ven. No alimenta el Sugerido.',
  tend: 'TENDENCIA — ▲ ALZA marca los productos con DOS ALZAS SEGUIDAS: los últimos tres '
    + 'meses completos subiendo uno sobre otro. Dos y no tres, a propósito — avisar lo antes '
    + 'posible; una sola alza no significa nada y esperar una tercera llega tarde. '
    + 'Es el aviso que pidió Wilmer el 2026-08-20: '
    + '"que me tire un signo de advertencia y que diga que está subiendo… entonces yo voy a '
    + 'revisar ya mejor mi Odoo y yo digo: ah sí, este amerita que le suba la punta". '
    + 'NO cambia el Sugerido — la decisión sigue siendo suya. '
    + 'El mes en curso no cuenta (está incompleto). '
    + '¿? = todavía no se puede evaluar (falta la serie mensual); no significa "sin tendencia".',
  destino: 'DÓNDE SE QUEDA de verdad este tránsito. Declararlo lo saca de las otras '
    + 'bodegas y se lo da entera a la que elijas — por eso el Sugerido de las demás sube. '
    + '⚠️ PROVISIONAL: sólo admite UN destino por producto, así que un furgón que descarga '
    + 'en varias bodegas NO se puede representar y el número queda mal. Es a propósito: '
    + 'sirve para acordar cómo debe funcionar de verdad. Vacío = sin declarar.',
  gap: 'Facturado 3m − Ordenado 3m, en % de lo ordenado. '
    + 'Un delta grande no es un error: son perímetros distintos. '
    + 'Lo facturado en tiendas se muestra aparte, abajo, y NUNCA se suma a una bodega.',
  sug:
    'Sugerido = max(0, forecast − max(0, exist. neta + tránsito − proyección)) + adicional. '
    + 'Forecast: promedio(6m, 3m, estacional) × 1.1 en General; promedio(6m, 3m) por bodega. '
    + 'Proyección: (promedio 3m ÷ 20) × ventana (10 General / 5 por bodega). '
    + '⚠️ El forecast se escala a los DÍAS QUE CUBRE esta bodega — 30 por defecto, '
    + '15 en Zacapa y Petén desde el 2026-08-21 a pedido de Wilmer, porque se resurten '
    + 'desde San José y no del proveedor. La ventana de proyección y el DOH NO cambian.',
} as const;

interface ApiRow {
  productId: number;
  cod: string; desc: string; prov: string; cat: string;
  /** Grupo de proveedores (2026-09-04) — null si el proveedor no está agrupado. */
  provGroupId: string | null;
  /** ABC (Wilmer, 2026-09-03) — ver classifyAbc en rows.ts. */
  abc: 'A' | 'B' | 'C' | 'D';
  /** Odoo product.template "Can be Purchased" — drives el filtro «Solo comprables». */
  purchaseOk: boolean;
  exist: number; existencias: number; reserved: number; patio: number;
  pending: number | null;
  trans: number; transOverridden: boolean;
  /** W15-A — destino final declarado a mano (null = sin declarar). */
  destino: string | null;
  /** W15-A — esa declaración está cambiando lo que se ve en esta bodega. */
  destinoProvisional: boolean;
  adic: number; adicComercial: number; sugBodega: number | null;
  transitoDetalle: { fecha: string | null; qty: number; orden: string | null }[];
  p6: number; p3: number; h: number; win: 10 | 5;
  /** G4 invoiced lens — display only, never fed to the engine. null = sync has not computed it. */
  f6: number | null; f3: number | null;
  /** Venta del mes en curso (parcial), días transcurridos y ritmo a 30 días. Display only. */
  mtd: number | null; mtdDias: number | null; mtdRitmo: number | null;
  seasonalMotivo: string | null;
  /** Rising-trend evaluation over the last 3 complete months. Display only. */
  tendencia: Tendencia;
  alerta: Alerta;
  doh: number; sug: number;
  flags: {
    pendingUnknown: boolean; seasonalLowConfidence: boolean; seasonalExcluded: boolean;
    tendenciaCreciente: boolean;
    revisar: boolean;
    sinReferenciaAnioAnterior: boolean;
  };
}
interface ApiMeta {
  count: number; asOf: string | null; month: string;
  /** Days of demand the Sugerido covers for this bodega (Wilmer 08-21: ZAC/PET = 15). */
  coberturaDias: number;
  lastSync: {
    id: string; status: string; started_at: string; finished_at: string | null;
    counts?: { data_horizon?: string | null };
  } | null;
}
interface Tiendas {
  porTienda: { tienda: string; f6: number; f3: number }[];
  total: { f6: number; f3: number };
  productos: number;
}
interface ApiPayload {
  bodega: string; bodegas: string[]; rows: ApiRow[]; groups: ProveedorGrupo[];
  tiendas?: Tiendas; meta: ApiMeta;
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
  const [onlyAlza, setOnlyAlza] = useState(false);
  const [onlyComprables, setOnlyComprables] = useState(false);
  // W16/W17 — null = el orden por defecto con el que la página siempre abrió.
  const [orden, setOrden] = useState<Orden | null>(null);
  // W18 — «que pueda hacer subconjuntos… solo los que estén en X número o menos».
  // Uno por columna, combinados con Y (mismo criterio que el resto de filtros).
  const [rangos, setRangos] = useState<Partial<Record<ClaveOrdenNumerica, FiltroRango>>>({});
  // Grupos de proveedores (2026-09-04) — panel de gestión, Wilmer-only.
  const [gruposAbierto, setGruposAbierto] = useState(false);
  const { profile } = useUserRole();
  const puedeGestionarGrupos = isAuthorized(profile?.role, CAN_MANAGE_SUPPLIER_GROUPS);
  const onRango = useCallback((k: ClaveOrdenNumerica, r: FiltroRango | null) => {
    setRangos((prev) => {
      const next = { ...prev };
      if (r) next[k] = r; else delete next[k];
      return next;
    });
  }, []);

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

  /**
   * Optimistic local recompute with the imported engine, then persist +
   * refetch. qty === null CLEARS the manual capture (pendiente → ¿?,
   * tránsito → valor sincronizado); the client can't compute that revert
   * locally (it doesn't hold the synced tránsito), so clears skip the
   * optimistic step and let the silent refetch repaint.
   */
  const commitEdit = useCallback(async (
    row: ApiRow,
    kind: 'transito' | 'pendiente',
    qty: number | null,
  ) => {
    setSaveError(null);
    if (qty !== null && qty > MAX_MANUAL_QTY) {
      setSaveError(
        `No se guardó el cambio de ${kind} (${row.cod}): supera el máximo de captura manual `
        + `(${fmt(MAX_MANUAL_QTY)}). Si el valor real es mayor, reportalo con el botón de bugs.`,
      );
      return;
    }
    if (qty !== null) setPayload((prev) => {
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

  /**
   * W15-A — declarar (o borrar) el destino final. Append-only.
   *
   * No hay recálculo optimista: mover el tránsito de una bodega a otra cambia
   * filas de OTRAS vistas, y el cliente sólo tiene la suya. El refetch
   * silencioso repinta con la verdad del servidor, que es la misma regla que
   * ya gobierna el clear de tránsito.
   */
  /**
   * A4.17 — el pedido adicional que mandó el encargado del CD.
   *
   * Sin recálculo optimista: el aditivo entra al Sugerido por el motor del
   * SERVIDOR, y recalcularlo acá sería la segunda implementación de la fórmula
   * que este módulo existe para evitar. El refetch silencioso repinta con la
   * verdad del servidor, igual que el clear de tránsito y que el destino.
   */
  const commitSugBodega = useCallback(async (row: ApiRow, qty: number | null) => {
    setSaveError(null);
    try {
      const res = await fetch('/api/compras/reabastecimiento/sugerido-bodega', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: row.productId, bodega, qty }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      load(bodega, true);
    } catch (e) {
      setSaveError(
        `No se guardó el sugerido de bodega (${row.cod}): ${e instanceof Error ? e.message : e}`);
      load(bodega, true);
    }
  }, [bodega, load]);

  const commitDestino = useCallback(async (row: ApiRow, destino: string | null) => {
    setSaveError(null);
    try {
      const res = await fetch('/api/compras/reabastecimiento/destino', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: row.productId, vistaBodega: bodega, destino }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      load(bodega, true);
    } catch (e) {
      setSaveError(`No se guardó el destino de ${row.cod}: ${e instanceof Error ? e.message : e}`);
      load(bodega, true);
    }
  }, [bodega, load]);

  /** Bodegas físicas — General es la suma, no un lugar donde algo se quede. */
  const destinos = useMemo(
    () => (payload?.bodegas ?? []).filter((b) => b !== 'General'),
    [payload],
  );

  // Grupos de proveedores (2026-09-04) — solo los que tienen al menos una fila
  // visible en ESTA bodega, para no ensuciar el filtro con grupos vacíos acá.
  const gruposEnBodega = useMemo(() => {
    const idsPresentes = new Set(
      (payload?.rows ?? []).map((r) => r.provGroupId).filter((id): id is string => id !== null),
    );
    return (payload?.groups ?? []).filter((g) => idsPresentes.has(g.id));
  }, [payload]);

  // Nombres crudos SIN grupo — mismo cálculo que antes, menos los que ahora
  // están agrupados (esos se ven como su grupo, no por su nombre suelto).
  const provList = useMemo(
    () => [...new Set(
      (payload?.rows ?? []).filter((r) => r.provGroupId === null).map((r) => r.prov).filter(Boolean),
    )].sort(),
    [payload],
  );

  /**
   * Filtrar y DESPUÉS ordenar — su secuencia de trabajo, en `lib/compras/tabla`
   * para que sea testeable sin renderizar la página. El orden por defecto
   * (activos primero, urgencia por DOH) se conserva: dejó de ser el único y
   * pasó a ser con el que abre.
   */
  const list = useMemo(() => vista(
    payload?.rows ?? [],
    {
      texto: q,
      proveedor: prov,
      soloConSugerido: onlySug,
      soloCriticos: onlyCrit,
      soloEnAlza: onlyAlza,
      soloComprables: onlyComprables,
      rangos,
    },
    orden,
  ), [payload, q, prov, onlySug, onlyCrit, onlyAlza, onlyComprables, rangos, orden]);

  const onSort = useCallback((k: ClaveOrden) => {
    setOrden((actual) => siguienteOrden(actual, k));
  }, []);

  // computeKpis/computeAlza/computeTopProveedores live in lib/compras/statusMetrics
  // so the "proof of status" snapshot route can compute the identical numbers
  // server-side — one function, two callers, never allowed to drift apart.
  const alza = useMemo(() => computeAlza(payload?.rows ?? []), [payload]);
  const kpis = useMemo(() => computeKpis(list), [list]);
  const topProv = useMemo(() => computeTopProveedores(payload?.rows ?? []), [payload]);

  const sync = payload?.meta.lastSync ?? null;
  const noData = !loading && !error && (payload?.rows.length ?? 0) === 0;

  /**
   * La fila, extraída para que la vista plana y la agrupada rendericen
   * EXACTAMENTE lo mismo. Duplicar este bloque sería garantizar que las dos
   * vistas se separen: la próxima columna se agregaría en una sola y nadie
   * lo notaría hasta que un número no coincida entre modos.
   */
  const renderFila = useCallback((r: ApiRow) => {
  const band = sev(r.doh);
  // El resaltado de fila lo dispara la alerta COMBINADA
  // (sube Y se despegó de su base), no las dos alzas solas:
  // medido el 2026-09-01, subir por sí solo marcaba una
  // porción de la tabla demasiado grande para leerse.
  const alzaRow = r.flags.revisar;
  return (
    <tr key={r.productId}
        className={alzaRow
          ? 'bg-amber-50/70 hover:bg-amber-100/70 shadow-[inset_4px_0_0_0_rgb(245,158,11)]'
          : 'hover:bg-teal-50/50'}>
      <td className="px-3 py-2 border-b border-gray-100 text-left">{r.cod}</td>
      <td className="px-3 py-2 border-b border-gray-100 text-center">
        <span className={`inline-block w-6 text-center px-1.5 py-0.5 rounded-full font-semibold text-xs ${ABC_PILL[r.abc]}`}>
          {r.abc}
        </span>
      </td>
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
          onClear={r.transOverridden
            ? () => commitEdit(r, 'transito', null) : undefined}
          clearTip="Quitar captura manual — vuelve al tránsito sincronizado"
        />
        {r.destinoProvisional && (
          <span
            title={`Tránsito provisional — declarado con destino ${r.destino}. `
              + 'Si el furgón descarga en varias bodegas, este número está mal.'}
            className="ml-1 text-[10px] font-bold text-indigo-600 cursor-help"
          >~</span>
        )}
        <ProximaEntrada detalle={r.transitoDetalle} manual={r.transOverridden} />
      </td>
      <td className="px-3 py-2 border-b border-gray-100 text-right">
        <DestinoSelect
          value={r.destino}
          opciones={destinos}
          label={`Destino final ${r.cod}`}
          onChange={(d) => commitDestino(r, d)}
        />
      </td>
      <td className="px-3 py-2 border-b border-gray-100 text-right">
        <QtyInput
          value={r.pending}
          edited={r.pending !== null}
          unknown={r.flags.pendingUnknown}
          label={`Pendiente de tomar reserva ${r.cod}`}
          onCommit={(v) => commitEdit(r, 'pendiente', v)}
          onClear={r.pending !== null
            ? () => commitEdit(r, 'pendiente', null) : undefined}
          clearTip="Quitar captura manual — vuelve a ¿? (sin dato)"
        />
      </td>
      <td className="px-3 py-2 border-b border-gray-100 text-right text-gray-500">{fmt(r.adic)}</td>
      <td className="px-3 py-2 border-b border-gray-100 text-right text-gray-700">{fmt(r.p6)}</td>
      <td className="px-3 py-2 border-b border-gray-100 text-right text-gray-700">{fmt(r.p3)}</td>
      <td className="px-3 py-2 border-b border-gray-100 text-right">
        <MesEnCurso mtd={r.mtd} dias={r.mtdDias} ritmo={r.mtdRitmo} p3={r.p3} />
      </td>
      <td className="px-3 py-2 border-b border-gray-100 text-center">
        <TendenciaCell t={r.tendencia} alerta={r.alerta}
                       sinRef={r.flags.sinReferenciaAnioAnterior} />
      </td>
      {/* Q9 — see the header comment. Restore these three
          together with their <Th> or the columns misalign. */}
      {/* <td className="px-3 py-2 border-b border-gray-100 text-right text-indigo-700">
        {r.f6 === null ? <span className="text-gray-300" title="Sin calcular todavía">¿?</span> : fmt(r.f6)}
      </td>
      <td className="px-3 py-2 border-b border-gray-100 text-right text-indigo-700">
        {r.f3 === null ? <span className="text-gray-300" title="Sin calcular todavía">¿?</span> : fmt(r.f3)}
      </td>
      <td className="px-3 py-2 border-b border-gray-100 text-right">
        <GapCell ordered={r.p3} invoiced={r.f3} />
      </td> */}
      <td className="px-3 py-2 border-b border-gray-100 text-right">
        <QtyInput
          value={r.sugBodega}
          edited={r.sugBodega !== null}
          label={`Sugerido de bodega — ${r.cod}`}
          onCommit={(v) => commitSugBodega(r, v)}
          onClear={r.sugBodega !== null ? () => commitSugBodega(r, null) : undefined}
          clearTip="Quitar el pedido del centro de distribución"
        />
      </td>
      <td className={`px-3 py-2 border-b border-gray-100 text-right font-bold ${r.sug > 0 ? 'text-teal-700' : 'text-gray-400'}`}
          title={r.flags.seasonalExcluded
            ? `Sin término estacional — ${r.seasonalMotivo ?? ''} Forecast = promedio(6m, 3m) × 1.1.`
            : r.flags.seasonalLowConfidence ? 'Estacional sin datos — confianza baja' : undefined}>
        {fmt(r.sug)}
        {alzaRow ? (
          <TrendingUp size={13} strokeWidth={3}
                      className="inline-block ml-1 -mt-0.5 text-amber-600" />
        ) : null}
        {r.flags.seasonalLowConfidence ? <span className="text-amber-500">*</span> : null}
        {r.flags.seasonalExcluded ? <span className="text-indigo-500">†</span> : null}
      </td>
    </tr>
  );
  }, [commitEdit, commitDestino, commitSugBodega, destinos]);

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
              title={BODEGA_TIP[b]}
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
        <Kpi label="Productos" value={fmt(kpis.total)} sub={`bodega ${bodega}`} icon={<Boxes size={16} />}
             tip={`Productos visibles con los filtros actuales. ${BODEGA_TIP[bodega] ?? ''}`} />
        <Kpi label="Requieren compra" value={fmt(kpis.need)} sub="sugerido > 0" accent
             tip="Productos con Sugerido > 0 (tras filtros)." />
        <Kpi label="Unidades sugeridas" value={fmt(kpis.totSug)} sub="total a comprar" accent
             tip="Suma del Sugerido de los productos que requieren compra (tras filtros)." />
        <Kpi label="Quiebre inminente" value={fmt(kpis.crit)} sub="DOH < 3 días" danger
             tip="Productos con DOH < 3 días (banda crítica del semáforo, tras filtros)." />
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
            <ProveedorFiltro
              value={prov}
              onChange={setProv}
              grupos={gruposEnBodega}
              nombresSueltos={provList}
              onGestionar={puedeGestionarGrupos ? () => setGruposAbierto(true) : undefined}
            />
            <label className="text-xs text-gray-600 inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={onlySug} onChange={(e) => setOnlySug(e.target.checked)} /> Solo con sugerido
            </label>
            <label className="text-xs text-gray-600 inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={onlyCrit} onChange={(e) => setOnlyCrit(e.target.checked)} /> Solo quiebre
            </label>
            <label className={`text-xs inline-flex items-center gap-1.5 cursor-pointer rounded-full px-2.5 py-1 border font-semibold ${
              onlyAlza
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'}`}>
              <input type="checkbox" className="accent-amber-600"
                     checked={onlyAlza} onChange={(e) => setOnlyAlza(e.target.checked)} />
              <TrendingUp size={13} strokeWidth={3} />
              Solo en alza ({alza.creciente})
            </label>
            <label className="text-xs text-gray-600 inline-flex items-center gap-1.5 cursor-pointer"
                   title="Deja fuera los productos marcados en Odoo como no comprables (purchase_ok).">
              <input type="checkbox" checked={onlyComprables}
                     onChange={(e) => setOnlyComprables(e.target.checked)} /> Solo comprables
            </label>
            <div className="ml-auto flex items-center gap-2">
              <CopiarTabla filas={list} bodega={bodega} />
              <ExportCarvajal productIds={list.map((r) => r.productId)} bodega={bodega} />
              <SnapshotButton
                bodega={bodega}
                filtros={{
                  texto: q, proveedor: prov, soloConSugerido: onlySug, soloCriticos: onlyCrit,
                  soloEnAlza: onlyAlza, soloComprables: onlyComprables, rangos,
                }}
                orden={orden}
                visibleCount={list.length}
                canViewAllSnapshots={profile?.role === 'superuser'}
              />
            </div>
          </div>

          {alza.noEvaluable > 0 && alza.total > 0 ? (
            <div className="mx-3 mb-3 flex items-start gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-gray-500" />
              <span>
                <b>{alza.noEvaluable}</b> de {alza.total} productos todavía <b>no se pueden evaluar</b> por
                tendencia — les falta la serie mensual, que se llena en la próxima sincronización.
                Eso <b>no</b> quiere decir que no estén subiendo.
              </span>
            </div>
          ) : null}

          {payload?.meta ? (
            <div className="mx-3 mb-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700">
              <span className="font-semibold">Sugerido a {payload.meta.coberturaDias} días</span>
              <span className="text-gray-400">·</span>
              <span className="text-gray-500">
                {payload.meta.coberturaDias === 30
                  ? 'horizonte por defecto'
                  : `${bodega} se resurte desde San José, no del proveedor`}
              </span>
            </div>
          ) : null}

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
                    <Th left tip={COL_TIP.cod} sortKey="cod" orden={orden} onSort={onSort}>Código</Th>
                    <Th tip={COL_TIP.abc}>ABC</Th>
                    <Th left tip={COL_TIP.desc} sortKey="prov" orden={orden} onSort={onSort}>Descripción / Proveedor</Th>
                    <Th tip={COL_TIP.exist} sortKey="exist" orden={orden} onSort={onSort}
                        filtroKey="exist" rango={rangos.exist} onRango={onRango}>Exist. neta</Th>
                    <Th tip={COL_TIP.patio} sortKey="patio" orden={orden} onSort={onSort}
                        filtroKey="patio" rango={rangos.patio} onRango={onRango}>Patio</Th>
                    <Th tip={COL_TIP.doh} sortKey="doh" orden={orden} onSort={onSort}
                        filtroKey="doh" rango={rangos.doh} onRango={onRango}>DOH</Th>
                    <Th tip={COL_TIP.trans} sortKey="trans" orden={orden} onSort={onSort}
                        filtroKey="trans" rango={rangos.trans} onRango={onRango}><span className="inline-flex items-center gap-1">Tránsito <Pencil size={11} /></span></Th>
                    <Th tip={COL_TIP.destino}><span className="inline-flex items-center gap-1">Destino final <Pencil size={11} /></span></Th>
                    <Th tip={COL_TIP.pend} sortKey="pending" orden={orden} onSort={onSort}
                        filtroKey="pending" rango={rangos.pending} onRango={onRango}><span className="inline-flex items-center gap-1">Pend. reserva <Pencil size={11} /></span></Th>
                    <Th tip={COL_TIP.adic} sortKey="adic" orden={orden} onSort={onSort}
                        filtroKey="adic" rango={rangos.adic} onRango={onRango}>Adic.</Th>
                    <Th tip={COL_TIP.ord} sortKey="p6" orden={orden} onSort={onSort}
                        filtroKey="p6" rango={rangos.p6} onRango={onRango}>Ord. 6m</Th>
                    <Th tip={COL_TIP.ord} sortKey="p3" orden={orden} onSort={onSort}
                        filtroKey="p3" rango={rangos.p3} onRango={onRango}>Ord. 3m</Th>
                    <Th tip={COL_TIP.mes} filtroKey="mtd" rango={rangos.mtd} onRango={onRango}>Mes en curso</Th>
                    <Th tip={COL_TIP.tend}>Tendencia</Th>
                    {/* Q9 (Jorge, 2026-08-26) — facturación is off Wilmer's screen.
                        His reason, given twice: "yo trabajo con lo ordenado, no con
                        esto" — invoiced sales are censored by our own stockouts, so
                        reading them as demand bakes the shortage into the next order.
                        Δ goes with them: it is Facturado 3m − Ordenado 3m, meaningless
                        once its sources are gone. Presentation only — f3/f6 still
                        arrive from the API and never reached the engine. */}
                    {/* <Th tip={COL_TIP.fact}>Fact. 6m</Th>
                    <Th tip={COL_TIP.fact}>Fact. 3m</Th>
                    <Th tip={COL_TIP.gap}>Δ</Th> */}
                    <Th tip={COL_TIP.sugBodega}>Pide bodega</Th>
                    <Th tip={COL_TIP.sug} sortKey="sug" orden={orden} onSort={onSort}
                        filtroKey="sug" rango={rangos.sug} onRango={onRango}>Sugerido</Th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {list.slice(0, 400).map((r) => renderFila(r))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-xs text-gray-500 px-3 py-2.5 border-t border-gray-100">
            Mostrando <b>{Math.min(400, list.length)}</b> de <b>{list.length}</b> productos
            {list.length > 400 ? ' (primeros 400 — refiná con filtros)' : ''} · bodega <b>{bodega}</b>
            {' '}· <span className="inline-flex items-center gap-1 font-semibold text-amber-700"><TrendingUp size={12} strokeWidth={3} />ALZA</span>
            {' '}= dos alzas seguidas (3 meses completos subiendo) — aviso, no cambia el Sugerido
            {' '}· <span className="text-amber-600">*</span> = estacional con confianza baja
            {list.some((r) => r.flags.seasonalExcluded)
              ? <> · <span className="text-indigo-500">†</span> = sin término estacional por decisión explícita (ver el tooltip del Sugerido)</>
              : null}
          </div>
          {/* Q24 (Jorge, 2026-08-27) — COMMENTED OUT, not deleted, on purpose.
              Wilmer has never said anything about this panel, for or against;
              nobody knows whether he reads it. So it goes dark and we watch:
              if he does not notice its absence within a few days, it and
              `TiendasPanel` below come out for good. If he asks where it
              went, uncomment this line and nothing was lost.
              The API still returns `payload.tiendas` — no endpoint changed. */}
          {/* {payload?.tiendas ? <TiendasPanel tiendas={payload.tiendas} /> : null} */}
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <h2
              title="Suma de unidades sugeridas por proveedor (top 8, sin filtros). Barra roja = el proveedor tiene productos en quiebre (DOH < 3) que requieren compra."
              className="text-xs uppercase tracking-wide text-gray-500 font-semibold px-4 py-3 border-b border-gray-100 cursor-help"
            >
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
              El botón ✕ junto a una captura manual la quita (tránsito vuelve al sincronizado;
              pendiente vuelve a ¿?), y vaciar la casilla hace lo mismo.
              Captura máxima: {fmt(MAX_MANUAL_QTY)} unidades.
              Los encabezados con flechas ordenan.
            </p>
            {/* W15-A — la sonda se anuncia como sonda. Si él no sabe que le
                estamos preguntando algo, no vamos a obtener la respuesta. */}
            <p className="mt-2 text-[11px] text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
              <b>«Destino final» es provisional y queremos tu opinión.</b> Hoy el tránsito llega sin
              separar por bodega, así que se ve el mismo en las tres y eso te tapa el Sugerido.
              Mientras lo arreglamos de raíz, esta columna te deja decir dónde se queda de verdad:
              lo que declarés sale de las otras bodegas y su Sugerido sube. Las filas afectadas
              quedan marcadas con <b className="text-indigo-600">~</b>.
              {' '}<b>Ya sabemos que se queda corta</b> — un furgón que descarga en San José, Zacapa
              y Petén no cabe en un solo destino. Contanos qué te falta y con eso diseñamos lo definitivo.
            </p>
          </div>
        </div>
      </div>
      {gruposAbierto && (
        <ProveedorGruposPanel onClose={() => { setGruposAbierto(false); load(bodega, true); }} />
      )}
    </div>
  );
}

/**
 * G4 — the delta between the two lenses, stated plainly.
 *
 * A big delta is NOT an error and must never read like one: Wilmer's ordered
 * basis and Raquel's invoiced basis cover different perimeters. Measured
 * 2026-08-20 for July: on the distribution centres the two agree within 4.1%;
 * company-wide they differ by 113%, and that difference is retail store
 * billing, which appears in its own panel below the table.
 */
/**
 * "Compara la venta del mes vs el promedio" — Wilmer, 2026-08-20.
 *
 * The month-to-date figure with the days elapsed, plus the 30-day pace it
 * implies. The day count is never omitted: a partial month read as a full one
 * is exactly the misreading this column exists to prevent.
 */
/**
 * The rising-trend badge (Wilmer, 2026-08-20).
 *
 * Deliberately loud: he asked for a colour change or a warning sign, and the
 * marker it replaces — a 1-character amber asterisk — is exactly the kind of
 * thing that gets scrolled past. It is a NOTIFICATION: nothing here changes
 * the Sugerido.
 *
 * The tooltip carries the three months and their quantities, so the alert
 * argues for itself and he can see at a glance whether the rise is 5,084 →
 * 6,459 or 1 → 3. Magnitude is shown rather than filtered, because no minimum
 * was agreed and inventing one would hide real rises on slow movers.
 *
 * `no-evaluable` renders ¿? with the reason, never a blank or a dash: "we
 * cannot tell" and "it is not rising" are different answers.
 */
function TendenciaCell(
  { t, alerta, sinRef }: { t: Tendencia; alerta: Alerta; sinRef: boolean },
) {
  // «Revisar» gana sobre todo lo demás: es la conjunción de venir subiendo y
  // haberse despegado del propio promedio de 6 meses, que es el conjunto chico
  // y accionable. Ver el bloque DIVERGENCIA en lib/compras/tendencia.ts.
  if (alerta.estado === 'revisar') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5
                   text-[11px] font-bold uppercase tracking-wide text-white shadow-sm cursor-help"
        title={`${alerta.motivo} Es un aviso para que lo revises en Odoo; `
          + 'el Sugerido no fue modificado.'
          + (sinRef ? ` ${SIN_REFERENCIA_ANIO_ANTERIOR}.` : '')}
      >
        <TrendingUp size={12} strokeWidth={3} />
        Revisar
      </span>
    );
  }
  if (t.estado === 'no-evaluable') {
    return (
      <span className="text-gray-300 cursor-help"
            title={`Tendencia no evaluable — ${t.motivo ?? 'sin dato'}. No significa que no esté subiendo.`}>
        ¿?
      </span>
    );
  }
  if (t.estado === 'sin-tendencia') {
    return <span className="text-gray-300" title="Sin dos alzas seguidas en los últimos 3 meses completos">—</span>;
  }
  const detalle = t.meses.map((m) => `${m.month}: ${fmt(m.qty)}`).join('  →  ');
  const pct = t.alzaPct === null ? '' : `  (+${t.alzaPct.toFixed(0)}%)`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm cursor-help"
      title={`Dos alzas seguidas — ${detalle}${pct}. `
        + 'Aviso para que lo revises en Odoo; el Sugerido no fue modificado.'}
    >
      <TrendingUp size={12} strokeWidth={3} />
      Alza
    </span>
  );
}

function MesEnCurso({ mtd, dias, ritmo, p3 }: {
  mtd: number | null; dias: number | null; ritmo: number | null; p3: number;
}) {
  if (mtd === null || dias === null) return <span className="text-gray-300">—</span>;
  const tone = !p3 || ritmo === null ? 'text-gray-500'
    : ritmo > p3 * 1.15 ? 'text-teal-700 font-semibold'
      : ritmo < p3 * 0.85 ? 'text-amber-700' : 'text-gray-600';
  return (
    <span className={tone}
          title={`${fmt(mtd)} ordenado en ${dias} día${dias === 1 ? '' : 's'} del mes`
            + (ritmo !== null ? ` · ritmo ${fmt(ritmo)}/30 días vs promedio 3m ${fmt(p3)}` : '')}>
      {fmt(mtd)}
      <span className="text-gray-400 text-[11px]"> /{dias}d</span>
    </span>
  );
}

/** DORMANT since 2026-08-26 (Q9) — kept so restoring the Δ column is one edit. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- dormant, see above
function GapCell({ ordered, invoiced }: { ordered: number; invoiced: number | null }) {
  if (invoiced === null) return <span className="text-gray-300">—</span>;
  if (!ordered) {
    return invoiced
      ? <span className="text-indigo-600 text-xs" title="Facturado sin nada ordenado en la ventana">solo fact.</span>
      : <span className="text-gray-300">—</span>;
  }
  const pct = ((invoiced - ordered) / ordered) * 100;
  const tone = Math.abs(pct) < 10 ? 'text-gray-400'
    : Math.abs(pct) < 30 ? 'text-amber-600' : 'text-indigo-600';
  return (
    <span className={`text-xs ${tone}`} title={`Facturado 3m ${invoiced} vs ordenado 3m ${ordered}`}>
      {pct > 0 ? '+' : ''}{pct.toFixed(0)}%
    </span>
  );
}

/**
 * G4 — the retail perimeter, shown apart on purpose.
 *
 * Wilmer 2026-08-06 said tienda demand is a traslado that "al final es un
 * número para San José", but tiendas also place their own sale orders, so
 * folding these invoices into a bodega would double-count. Decision
 * 2026-08-20: show the split and let Wilmer and Raquel settle it with the
 * numbers in front of them.
 *
 * DORMANT since 2026-08-27 (Q24) — the call site above is commented out while
 * we find out whether Wilmer reads this at all. He has never mentioned it,
 * either way. Kept intact so restoring it is one line; delete both if the
 * silence holds.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- dormant, see above
function TiendasPanel({ tiendas }: { tiendas: Tiendas }) {
  if (!tiendas.porTienda.length) return null;
  return (
    <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
      <h3 className="text-sm font-semibold text-indigo-900">
        Facturado en tiendas — perímetro aparte, fuera del abasto
      </h3>
      <p className="mt-1 text-[11px] text-indigo-900/70 max-w-3xl">
        Estas ventas están en el reporte de Raquel y <b>no</b> en la base de Wilmer: las tiendas
        facturan al público sin orden de venta. No se suman a ninguna bodega ni al Sugerido —
        se muestran para que la diferencia entre los dos reportes tenga nombre en vez de discutirse.
        {' '}<b>{tiendas.productos}</b> productos.
      </p>
      <table className="mt-3 text-xs tabular-nums">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-indigo-900/60">
            <th className="text-left font-semibold px-3 py-1.5">Tienda</th>
            <th className="text-right font-semibold px-3 py-1.5">Fact. 6m</th>
            <th className="text-right font-semibold px-3 py-1.5">Fact. 3m</th>
          </tr>
        </thead>
        <tbody>
          {tiendas.porTienda.map((t) => (
            <tr key={t.tienda} className="border-t border-indigo-100">
              <td className="px-3 py-1.5 text-left text-indigo-900">{t.tienda}</td>
              <td className="px-3 py-1.5 text-right text-indigo-800">{fmt(t.f6)}</td>
              <td className="px-3 py-1.5 text-right text-indigo-800">{fmt(t.f3)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-indigo-200 font-semibold">
            <td className="px-3 py-1.5 text-left text-indigo-900">Total tiendas</td>
            <td className="px-3 py-1.5 text-right text-indigo-900">{fmt(tiendas.total.f6)}</td>
            <td className="px-3 py-1.5 text-right text-indigo-900">{fmt(tiendas.total.f3)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * W16 — un encabezado ordena si se le pasa `sortKey`.
 *
 * Los que no la reciben (Mes en curso, Tendencia) siguen siendo rótulos: no
 * son una cifra simple sobre la que «mayor a menor» signifique algo.
 */
function Th({
  children, left, tip, sortKey, orden, onSort, filtroKey, rango, onRango,
}: {
  children: React.ReactNode;
  left?: boolean;
  tip?: string;
  sortKey?: ClaveOrden;
  orden?: Orden | null;
  onSort?: (k: ClaveOrden) => void;
  /** W18 — columna numérica que acepta un filtro ≤/≥, además de (u opcional a) ordenar. */
  filtroKey?: ClaveOrdenNumerica;
  rango?: FiltroRango;
  onRango?: (k: ClaveOrdenNumerica, r: FiltroRango | null) => void;
}) {
  const activa = Boolean(sortKey && orden && orden.clave === sortKey);
  const ordenable = Boolean(sortKey && onSort);
  return (
    <th
      title={tip}
      aria-sort={activa ? (orden!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`${left ? 'text-left' : 'text-right'} font-semibold px-3 py-2.5 border-b border-gray-200 whitespace-nowrap ${
        ordenable ? 'cursor-pointer select-none hover:text-gray-900' : tip ? 'cursor-help' : ''
      } ${activa ? 'text-teal-700' : ''}`}
      onClick={ordenable ? () => onSort!(sortKey!) : undefined}
    >
      <span className={`inline-flex items-center gap-1 ${left ? '' : 'flex-row-reverse'}`}>
        {children}
        {ordenable && (
          activa
            ? (orden!.dir === 'asc' ? <ChevronUp size={12} strokeWidth={3} /> : <ChevronDown size={12} strokeWidth={3} />)
            : <ChevronsUpDown size={11} className="text-gray-300" />
        )}
        {filtroKey && onRango && <RangoFiltro clave={filtroKey} rango={rango} onChange={onRango} />}
      </span>
    </th>
  );
}

/**
 * W18 — «poder hacer subconjuntos… solo los que estén en X número o menos».
 *
 * Un filtro ≤/≥ por columna, uno por columna, combinados con Y en `tabla.ts`.
 * Vive en el encabezado (no en una barra aparte) para que quede junto al
 * control de orden de la MISMA columna — es el mismo gesto de Excel.
 */
function RangoFiltro({
  clave, rango, onChange,
}: {
  clave: ClaveOrdenNumerica;
  rango?: FiltroRango;
  onChange: (k: ClaveOrdenNumerica, r: FiltroRango | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [operador, setOperador] = useState<OperadorRango>(rango?.operador ?? 'lte');
  const [valor, setValor] = useState(rango ? String(rango.valor) : '');
  const activo = Boolean(rango);

  const abrir = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOperador(rango?.operador ?? 'lte');
    setValor(rango ? String(rango.valor) : '');
    setAbierto((v) => !v);
  };

  const aplicar = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const n = Number(valor);
    if (valor.trim() === '' || Number.isNaN(n)) return;
    onChange(clave, { operador, valor: n });
    setAbierto(false);
  };

  const limpiar = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(clave, null);
    setValor('');
    setAbierto(false);
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- solo evita que el click abra/cierre el orden de la columna
    <span className="relative inline-flex normal-case font-normal" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={abrir}
        title={activo ? `Filtro activo: ${operador === 'lte' ? '≤' : '≥'} ${rango!.valor} — click para editar` : 'Filtrar esta columna'}
        className={`p-0.5 rounded ${activo ? 'text-teal-700' : 'text-gray-300 hover:text-gray-500'}`}
      >
        <ListFilter size={11} />
      </button>
      {abierto && (
        <>
          {/* Fondo transparente para cerrar al hacer click fuera, mismo truco que otros popovers de la página. */}
          <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setAbierto(false); }} />
          <form
            onSubmit={aplicar}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-full mt-1 z-30 flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
          >
            <select
              value={operador}
              onChange={(e) => setOperador(e.target.value as OperadorRango)}
              className="text-xs border border-gray-200 rounded px-1 py-1"
            >
              <option value="lte">≤</option>
              <option value="gte">≥</option>
            </select>
            <input
              type="number"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              autoFocus
              className="w-20 text-xs border border-gray-200 rounded px-1.5 py-1"
              placeholder="valor"
            />
            <button type="submit" className="text-xs text-teal-700 font-semibold px-1.5 py-1 hover:bg-teal-50 rounded">
              Aplicar
            </button>
            {activo && (
              <button type="button" onClick={limpiar} title="Quitar filtro" className="text-gray-400 hover:text-gray-600 px-0.5">
                <X size={12} />
              </button>
            )}
          </form>
        </>
      )}
    </span>
  );
}

/**
 * W15-A — «Destino final», la sonda deliberada.
 *
 * Sabe que está mal y lo dice: un furgón puede descargar en San José, Zacapa y
 * Petén, y aquí sólo cabe un destino. Se construyó así a propósito (Jorge,
 * Q26, 2026-08-27) para que el límite aparezca en la práctica y podamos
 * diseñar lo correcto sobre algo observado y no sobre una suposición.
 *
 * Vacío = sin declarar, nunca un destino por omisión.
 */
function DestinoSelect({ value, opciones, label, onChange }: {
  value: string | null;
  opciones: string[];
  label: string;
  onChange: (destino: string | null) => void;
}) {
  return (
    <select
      value={value ?? ''}
      aria-label={label}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className={`text-xs rounded-md border px-1.5 py-1 max-w-[120px] focus:outline-none focus:ring-2 focus:ring-teal-600 ${
        value ? 'border-indigo-400 text-indigo-800 bg-indigo-50/50' : 'border-gray-200 text-gray-500'
      }`}
    >
      <option value="">— sin declarar —</option>
      {opciones.map((b) => <option key={b} value={b}>{b}</option>)}
    </select>
  );
}

export function QtyInput({ value, edited, unknown, label, onCommit, onClear, clearTip }: {
  value: number | null;
  edited: boolean;
  unknown?: boolean;
  label: string;
  onCommit: (v: number) => void;
  /** Present only while a manual capture exists — appends a clear entry. */
  onClear?: () => void;
  clearTip?: string;
}) {
  const [draft, setDraft] = useState<string>(value === null ? '' : String(Math.round(value)));
  useEffect(() => { setDraft(value === null ? '' : String(Math.round(value))); }, [value]);
  /**
   * W19 — emptying the box and tabbing out used to do NOTHING, silently.
   *
   * Wilmer, 2026-08-26, trying to remove a tránsito that was not his bodega's:
   * *"el tránsito no lo puedo quitar"* → he blanked the field → Jorge: *"dale
   * tabulación"* → *"Ah, no lo cambió."* → *"ahorita tengo que dar refresh"*.
   * Jorge: *"eso sí es un error de la aplicación"*.
   *
   * The old `if (draft.trim() === '') return` was written for `pendiente`,
   * where blank means "unknown" and must not be read as zero. It is correct
   * about zero and wrong about the gesture: it left the box visually empty
   * while the stored value was untouched, so the row LOOKED edited and the
   * Sugerido did not move. A silent no-op is the one outcome an input must
   * never have.
   *
   * Now blanking means what the ✕ next to it means — clear the manual capture
   * — whenever there is one to clear. With nothing captured there is nothing
   * to clear, so the draft simply snaps back to the real value instead of
   * lying about it. Either way the box always shows what is stored.
   */
  const commit = () => {
    if (draft.trim() === '') {
      if (onClear) onClear();
      else setDraft(value === null ? '' : String(Math.round(value)));
      return;
    }
    const v = parseFloat(draft);
    if (Number.isFinite(v) && v >= 0 && v !== value) onCommit(v);
  };
  return (
    <span className="inline-flex items-center gap-1">
      {unknown && <span title="Sin dato — no es cero" className="text-gray-400 font-bold">¿?</span>}
      <input
        type="number"
        min={0}
        max={MAX_MANUAL_QTY}
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
      {onClear && (
        <button
          type="button"
          title={clearTip}
          aria-label={`Quitar captura manual — ${label}`}
          onClick={onClear}
          className="text-gray-400 hover:text-red-600 transition"
        >
          <X size={13} />
        </button>
      )}
    </span>
  );
}

function Kpi({ label, value, sub, icon, accent, danger, tip }: {
  label: string; value: string; sub: string;
  icon?: React.ReactNode; accent?: boolean; danger?: boolean; tip?: string;
}) {
  return (
    <div title={tip} className={`bg-white border border-gray-200 rounded-xl p-4 shadow-sm ${tip ? 'cursor-help' : ''}`}>
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

/**
 * COPIAR — la tabla visible al portapapeles, en TSV.
 *
 * Responde a *«yo no digito, me prefiero copiar y pegar porque se me equivocó
 * un código»*. Se pega directo en la grilla de Odoo o en Excel: sin descargar,
 * sin abrir un archivo, y sin el riesgo de que Excel corrompa los códigos con
 * ceros a la izquierda al abrir un CSV.
 *
 * Copia EXACTAMENTE lo que está en pantalla — mismo orden, mismos filtros,
 * mismas filas. `list` ya viene ordenada y filtrada; acá no se vuelve a decidir
 * nada. Ese fue el defecto del 26-ago: el archivo se armaba por su cuenta y
 * devolvía otra bodega y códigos de otro proveedor.
 *
 * Las columnas son las de digitación —código, descripción, sugerido— y no toda
 * la tabla: lo que se pega en una orden de compra es eso. El resto de la
 * pantalla es para decidir, no para pegar.
 */
function CopiarTabla({ filas, bodega }: { filas: ApiRow[]; bodega: string }) {
  const [copiado, setCopiado] = useState<string | null>(null);

  const copiar = useCallback(async () => {
    const tsv = tablaATsv(filas, [
      { encabezado: 'Código', valor: (r: ApiRow) => r.cod },
      { encabezado: 'Descripción', valor: (r: ApiRow) => r.desc },
      { encabezado: 'Sugerido', valor: (r: ApiRow) => Math.round(r.sug) },
    ]);
    try {
      await navigator.clipboard.writeText(tsv);
      setCopiado(`${filas.length} filas copiadas`);
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS) no se pierde el trabajo:
      // el textarea de respaldo deja seleccionar y copiar a mano.
      setCopiado('No se pudo copiar automáticamente');
    }
    setTimeout(() => setCopiado(null), 3000);
  }, [filas]);

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={copiar}
        disabled={filas.length === 0}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm
                   text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        title={`Copiar las ${filas.length} filas visibles de ${bodega} para pegarlas en Odoo`}
      >
        Copiar
      </button>
      {copiado && <span className="text-xs text-gray-500">{copiado}</span>}
    </div>
  );
}

/**
 * A6.15 — «1,200 en tránsito: 500 entran el 24».
 *
 * Debajo del total, la PRÓXIMA entrada; el resto al pasar el mouse. Saber que
 * vienen 1,200 no ayuda a decidir si hay que comprar — lo que decide es si
 * entran esta semana o el mes que viene.
 *
 * ⚠️ NO SE MUESTRA cuando hay captura manual de tránsito. El desglose describe
 * lo que el sincronizador leyó de Odoo, y una captura manual REEMPLAZA ese
 * número: enseñar un desglose que ya no suma el total que está arriba es peor
 * que no mostrar nada, porque invita a confiar en fechas que no corresponden a
 * la cantidad visible.
 */
function ProximaEntrada(
  { detalle, manual }: {
    detalle: { fecha: string | null; qty: number; orden: string | null }[];
    manual: boolean;
  },
) {
  if (manual || detalle.length === 0) return null;

  const fmtFecha = (f: string | null) => (f
    ? new Date(`${f}T00:00:00`).toLocaleDateString('es-GT', { day: 'numeric', month: 'short' })
    : 'sin fecha');

  const [primera, ...resto] = detalle;
  const detalleCompleto = detalle
    .map((d) => `${fmt(d.qty)} — ${fmtFecha(d.fecha)}${d.orden ? ` (${d.orden})` : ''}`)
    .join('\n');

  return (
    <span
      className="block text-[11px] text-gray-500 cursor-help leading-tight"
      title={`Entradas previstas:\n${detalleCompleto}`}
    >
      {fmt(primera.qty)} el {fmtFecha(primera.fecha)}
      {resto.length > 0 && <span className="text-gray-400"> +{resto.length}</span>}
    </span>
  );
}
