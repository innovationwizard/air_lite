/**
 * Pure data-shaping for the reabastecimiento-vivo "proof of status" PDF —
 * types, timestamp/filename formatting, and the filter-summary line.
 *
 * Deliberately separate from reabastecimientoStatusPdf.tsx (which imports
 * @react-pdf/renderer): that package's dependency chain is ESM-only all the
 * way down (@react-pdf/*, color-string, @react-pdf/hyphenate's exports map
 * declaring only an "import" condition with no CJS fallback), which Jest's
 * CommonJS module resolver cannot load no matter how transformIgnorePatterns
 * is configured — a well-known class of problem with this package, not a bug
 * in this code. Splitting out everything that doesn't need react-pdf itself
 * keeps it independently unit-testable; the rendering path is verified
 * manually instead (see the plan's §5/§9 note that visual layout needs a real
 * render to judge, not a guess).
 */
import type { Filtros, Orden } from '@/lib/compras/tabla';

// ─────────────────────────────────────────────────────────────────────────
// Types — the full frozen payload, as returned by POST or GET .../snapshot/[id]
// ─────────────────────────────────────────────────────────────────────────

export interface SnapshotFila {
  productId: number;
  cod: string; desc: string; prov: string; cat: string;
  provGroupId: string | null;
  abc: 'A' | 'B' | 'C' | 'D';
  purchaseOk: boolean;
  exist: number; existencias: number; reserved: number; patio: number;
  pending: number | null;
  trans: number; transOverridden: boolean;
  destino: string | null;
  destinoProvisional: boolean;
  adic: number; adicComercial: number; sugBodega: number | null;
  transitoDetalle: { fecha: string | null; qty: number; orden: string | null }[];
  p6: number; p3: number; h: number; win: number;
  f6: number | null; f3: number | null;
  mtd: number | null; mtdDias: number | null; mtdRitmo: number | null;
  seasonalMotivo: string | null;
  tendencia: { estado: string; alzaPct: number | null; motivo: string | null; meses: { month: string; qty: number }[] };
  alerta: { estado: string; motivo: string | null };
  doh: number; sug: number;
  flags: {
    pendingUnknown: boolean; seasonalLowConfidence: boolean; seasonalExcluded: boolean;
    tendenciaCreciente: boolean; revisar: boolean; sinReferenciaAnioAnterior: boolean;
  };
}

export interface SnapshotMeta {
  asOf: string | null;
  month: string;
  coberturaDias: number;
  lastSync: { id: string; status: string; started_at: string; finished_at: string | null } | null;
}

export interface SnapshotKpis { total: number; need: number; totSug: number; crit: number }
export interface SnapshotAlza { creciente: number; noEvaluable: number; total: number }
export interface SnapshotTopProveedor { p: string; sug: number; crit: number }
export interface SnapshotTiendas {
  porTienda: { tienda: string; f6: number; f3: number }[];
  total: { f6: number; f3: number };
  productos: number;
}

export interface SnapshotPayload {
  id: string;
  createdAt: string;
  autor: string;
  bodega: string;
  filtros: Filtros;
  orden: Orden | null;
  meta: SnapshotMeta;
  kpis: SnapshotKpis;
  alza: SnapshotAlza;
  topProveedores: SnapshotTopProveedor[];
  tiendas: SnapshotTiendas;
  filas: SnapshotFila[];
  totalFilas: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Timestamp / filename — America/Guatemala local time, explicit in both.
// ─────────────────────────────────────────────────────────────────────────

const TZ = 'America/Guatemala';

function parts(iso: string): Record<string, string> {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** `YYYYMMDD-HHMMSS`, America/Guatemala local time — sorts correctly by default. */
export function filenameTimestamp(iso: string): string {
  const p = parts(iso);
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}

/** `2026-09-03 14:32:07 CST` — full timestamp, explicit timezone, for the printed footer. */
export function displayTimestamp(iso: string): string {
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} CST`;
}

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '').slice(0, 40) || 'usuario';
}

/**
 * `YYYYMMDD-HHMMSS_ReabastecimientoVivo_<Bodega>_<Autor>.pdf`. No
 * `document.title` trick needed here (that workaround is specific to
 * `window.print()`, which D-1 rules out) — a generated Blob downloaded via
 * `<a download>` gets exactly this filename, full stop.
 */
export function reabastecimientoStatusFilename(snapshot: SnapshotPayload): string {
  const autor = snapshot.autor.split('(')[0].trim() || snapshot.autor;
  return `${filenameTimestamp(snapshot.createdAt)}_ReabastecimientoVivo_${slug(snapshot.bodega)}_${slug(autor)}.pdf`;
}

// ─────────────────────────────────────────────────────────────────────────
// Filter summary — makes the scope of the proof legible without parsing JSON.
// ─────────────────────────────────────────────────────────────────────────

const ETIQUETAS_ORDEN: Record<string, string> = {
  cod: 'código', desc: 'descripción', prov: 'proveedor', exist: 'existencia',
  patio: 'patio', doh: 'DOH', trans: 'tránsito', pending: 'pendiente',
  adic: 'adicional', p6: 'prom. 6m', p3: 'prom. 3m', mtd: 'MTD', sug: 'sugerido',
};

export function describeFiltros(filtros: Filtros, orden: Orden | null): string {
  const partes: string[] = [];
  if (filtros.texto) partes.push(`texto "${filtros.texto}"`);
  if (filtros.proveedor) {
    partes.push(filtros.proveedor.startsWith('group:')
      ? `grupo de proveedores ${filtros.proveedor.slice(6)}`
      : `proveedor ${filtros.proveedor}`);
  }
  if (filtros.soloConSugerido) partes.push('solo con sugerido');
  if (filtros.soloCriticos) partes.push('solo críticos (DOH < 3)');
  if (filtros.soloEnAlza) partes.push('solo en alza');
  if (filtros.soloComprables) partes.push('solo comprables');
  for (const [clave, rango] of Object.entries(filtros.rangos ?? {})) {
    if (!rango) continue;
    partes.push(`${ETIQUETAS_ORDEN[clave] ?? clave} ${rango.operador === 'lte' ? '≤' : '≥'} ${rango.valor}`);
  }
  const filtroTexto = partes.length ? `Filtros: ${partes.join(' · ')}` : 'Sin filtros — catálogo completo';
  const ordenTexto = orden
    ? ` · Orden: ${ETIQUETAS_ORDEN[orden.clave] ?? orden.clave} ${orden.dir === 'asc' ? '↑' : '↓'}`
    : ' · Orden: por defecto (activos primero, urgencia por DOH)';
  return filtroTexto + ordenTexto;
}
