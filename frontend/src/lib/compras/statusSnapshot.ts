/**
 * Validation for the "proof of status" snapshot request
 * (POST /api/compras/reabastecimiento/snapshot).
 *
 * The client sends only the VIEWING PARAMETERS (bodega, filtros, orden) —
 * never row data. The server re-derives the frozen rows itself from these
 * (buildRows + vista), so what gets stored can't be a fabricated or stale
 * client payload. See the migration's header comment and
 * docs/compras/PROOF_OF_STATUS_IMPLEMENTATION_PLAN_2026-09-03.md §1/§4.
 *
 * Same "return an error STRING, never throw, never a silent default"
 * convention as lib/compras/draft.ts.
 */
import type { ClaveOrden, ClaveOrdenNumerica, Filtros, FiltroRango, Orden, OperadorRango } from './tabla';

const CLAVES_ORDEN: readonly ClaveOrden[] = [
  'cod', 'desc', 'prov', 'exist', 'patio', 'doh', 'trans', 'pending', 'adic', 'p6', 'p3', 'mtd', 'sug',
];
const CLAVES_NUMERICAS: readonly ClaveOrdenNumerica[] = [
  'exist', 'patio', 'doh', 'trans', 'pending', 'adic', 'p6', 'p3', 'mtd', 'sug',
];
const MAX_TEXTO_LEN = 200;
const MAX_PROVEEDOR_LEN = 200;

function isClaveOrden(v: unknown): v is ClaveOrden {
  return typeof v === 'string' && (CLAVES_ORDEN as readonly string[]).includes(v);
}
function isClaveNumerica(v: string): v is ClaveOrdenNumerica {
  return (CLAVES_NUMERICAS as readonly string[]).includes(v);
}

/** `null` is a legal value (D-4/D-5 in tabla.ts: null = the default order). */
export function readSnapshotOrden(raw: unknown): Orden | null | string {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'orden debe ser un objeto o null';
  const o = raw as Record<string, unknown>;
  if (!isClaveOrden(o.clave)) return 'orden.clave inválida';
  if (o.dir !== 'asc' && o.dir !== 'desc') return 'orden.dir debe ser asc o desc';
  return { clave: o.clave, dir: o.dir };
}

function readRangos(raw: unknown): Partial<Record<ClaveOrdenNumerica, FiltroRango>> | string {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'filtros.rangos debe ser un objeto';
  const out: Partial<Record<ClaveOrdenNumerica, FiltroRango>> = {};
  for (const [clave, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isClaveNumerica(clave)) return `filtros.rangos: clave desconocida "${clave}"`;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      return `filtros.rangos.${clave} debe ser un objeto`;
    }
    const r = v as Record<string, unknown>;
    const operador = r.operador as OperadorRango;
    if (operador !== 'lte' && operador !== 'gte') {
      return `filtros.rangos.${clave}.operador debe ser lte o gte`;
    }
    if (typeof r.valor !== 'number' || !Number.isFinite(r.valor)) {
      return `filtros.rangos.${clave}.valor debe ser un número`;
    }
    out[clave] = { operador, valor: r.valor };
  }
  return out;
}

export function readSnapshotFiltros(raw: unknown): Filtros | string {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'filtros debe ser un objeto';
  const f = raw as Record<string, unknown>;

  const out: Filtros = {};
  if (f.texto !== undefined) {
    if (typeof f.texto !== 'string') return 'filtros.texto debe ser texto';
    if (f.texto.length > MAX_TEXTO_LEN) return `filtros.texto excede ${MAX_TEXTO_LEN} caracteres`;
    out.texto = f.texto;
  }
  if (f.proveedor !== undefined) {
    if (typeof f.proveedor !== 'string') return 'filtros.proveedor debe ser texto';
    if (f.proveedor.length > MAX_PROVEEDOR_LEN) return `filtros.proveedor excede ${MAX_PROVEEDOR_LEN} caracteres`;
    out.proveedor = f.proveedor;
  }
  for (const bool of ['soloConSugerido', 'soloCriticos', 'soloEnAlza', 'soloComprables'] as const) {
    if (f[bool] !== undefined) {
      if (typeof f[bool] !== 'boolean') return `filtros.${bool} debe ser booleano`;
      out[bool] = f[bool];
    }
  }
  const rangos = readRangos(f.rangos);
  if (typeof rangos === 'string') return rangos;
  out.rangos = rangos;
  return out;
}
