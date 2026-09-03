/**
 * Pure-function tests for the "proof of status" PDF's data shaping. The
 * actual react-pdf rendering (reabastecimientoStatusPdf.tsx) is verified
 * manually, not here — see that file's header comment and
 * reabastecimientoStatusPdf.helpers.ts's for why: @react-pdf/renderer's
 * dependency chain is ESM-only in a way Jest's CommonJS resolver can't load.
 */
import {
  filenameTimestamp, displayTimestamp, describeFiltros, reabastecimientoStatusFilename,
  type SnapshotPayload,
} from '../reabastecimientoStatusPdf.helpers';

function snapshot(over: Partial<SnapshotPayload> = {}): SnapshotPayload {
  return {
    id: 'snap-1', createdAt: '2026-09-03T20:32:07.000Z', autor: 'Wilmer González (wilmer@example.com)',
    bodega: 'General',
    filtros: { texto: '', proveedor: '', soloConSugerido: false, soloCriticos: true, soloEnAlza: false, soloComprables: true, rangos: {} },
    orden: { clave: 'doh', dir: 'asc' },
    meta: { asOf: '2026-09-03', month: '2026-09-01', coberturaDias: 30, lastSync: null },
    kpis: { total: 1, need: 1, totSug: 300, crit: 1 },
    alza: { creciente: 1, noEvaluable: 0, total: 1 },
    topProveedores: [],
    tiendas: { porTienda: [], total: { f6: 0, f3: 0 }, productos: 0 },
    filas: [],
    totalFilas: 1,
    ...over,
  };
}

describe('filenameTimestamp / displayTimestamp', () => {
  it('renders America/Guatemala local time (UTC-6, no DST) in both formats', () => {
    // 20:32:07 UTC on 2026-09-03 → 14:32:07 in Guatemala.
    expect(filenameTimestamp('2026-09-03T20:32:07.000Z')).toBe('20260903-143207');
    expect(displayTimestamp('2026-09-03T20:32:07.000Z')).toBe('2026-09-03 14:32:07 CST');
  });
});

describe('reabastecimientoStatusFilename', () => {
  it('builds a sortable, timestamp-prefixed filename with bodega and autor', () => {
    expect(reabastecimientoStatusFilename(snapshot())).toBe(
      '20260903-143207_ReabastecimientoVivo_General_WilmerGonzalez.pdf',
    );
  });

  it('strips accents/punctuation from bodega and autor rather than emitting invalid filename characters', () => {
    const name = reabastecimientoStatusFilename(snapshot({
      bodega: 'Zacapa-Petén', autor: 'Wilmer González',
    }));
    expect(name).toMatch(/^\d{8}-\d{6}_ReabastecimientoVivo_ZacapaPeten_WilmerGonzalez\.pdf$/);
  });
});

describe('describeFiltros', () => {
  it('summarizes active filters, joined, human-readable', () => {
    const texto = describeFiltros(
      { soloCriticos: true, soloComprables: true, proveedor: 'Carvajal' },
      { clave: 'doh', dir: 'asc' },
    );
    expect(texto).toContain('proveedor Carvajal');
    expect(texto).toContain('solo críticos');
    expect(texto).toContain('solo comprables');
    expect(texto).toContain('DOH ↑');
  });

  it('says so explicitly when there are no filters at all', () => {
    expect(describeFiltros({}, null)).toBe('Sin filtros — catálogo completo · Orden: por defecto (activos primero, urgencia por DOH)');
  });

  it('labels a supplier-group filter distinctly from a raw provider name', () => {
    expect(describeFiltros({ proveedor: 'group:abc-123' }, null)).toContain('grupo de proveedores abc-123');
  });
});
