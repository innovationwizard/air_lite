/**
 * PDF rendering for the "proof of status" snapshot of
 * /compras/reabastecimiento-vivo. Plan: docs/compras/PROOF_OF_STATUS_IMPLEMENTATION_PLAN_2026-09-03.md §5.
 *
 * Client-side vector PDF (@react-pdf/renderer, D-4) — no headless browser, no
 * `window.print()` (D-1). Renders ONLY from the frozen snapshot payload
 * returned by the server (POST or GET .../snapshot/[id]) — never from local
 * page state, so the PDF can never drift from the stored record.
 *
 * LAYOUT (D-9: print layout is independent of screen layout; all columns,
 * all cells; reordering/pagination allowed as long as headers and row
 * identifiers are always present on every page):
 *
 * VivoClient.tsx's on-screen table has 20+ columns — that does not fit at a
 * readable size as one wide table row, even in landscape, with a
 * flexbox-style layout that (unlike a spreadsheet) does not auto-shrink to
 * fit. Instead, each product renders as its own bordered, LABELED block:
 * every value carries its own inline label (`Exist 120 · Tránsito 45 · DOH
 * 3.2 …`), so a reader never has to scroll back to a header row to know what
 * a number means — which also means the "headers on every page" requirement
 * is satisfied structurally, not by repeating a table header. Each block is
 * `wrap={false}` (never splits across a page break), so the row identifier
 * (`cod · desc`) is always whole and adjacent to its own data, on whatever
 * page the block lands on. The page-level header/footer (author, generation
 * timestamp, bodega, filters, page N of M) is a `fixed` element, so it
 * repeats on every page regardless of how many product blocks fit.
 *
 * Types, timestamp/filename formatting and the filter-summary line live in
 * reabastecimientoStatusPdf.helpers.ts — split out so they're testable
 * without pulling in @react-pdf/renderer (see that file's header comment for
 * why). Re-exported from here so nothing outside this module needs to know
 * about the split.
 */
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { displayTimestamp, describeFiltros, reabastecimientoStatusFilename, type SnapshotFila, type SnapshotPayload } from './reabastecimientoStatusPdf.helpers';

export * from './reabastecimientoStatusPdf.helpers';

// ─────────────────────────────────────────────────────────────────────────
// Document
// ─────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: { paddingTop: 64, paddingBottom: 40, paddingHorizontal: 24, fontSize: 8, fontFamily: 'Helvetica' },
  fixedHeader: {
    position: 'absolute', top: 16, left: 24, right: 24,
    borderBottom: '1pt solid #999', paddingBottom: 6,
  },
  fixedFooter: {
    position: 'absolute', bottom: 12, left: 24, right: 24,
    borderTop: '1pt solid #ccc', paddingTop: 4,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  title: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  metaLine: { fontSize: 8, color: '#444', marginTop: 2 },
  footerText: { fontSize: 7, color: '#666' },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 4 },
  kpiRow: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  kpiBox: { border: '1pt solid #ccc', padding: 6, minWidth: 90 },
  kpiValue: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  kpiLabel: { fontSize: 7, color: '#555' },
  block: { border: '1pt solid #bbb', padding: 5, marginBottom: 4 },
  blockHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  cod: { fontFamily: 'Helvetica-Bold', fontSize: 9 },
  desc: { fontSize: 8, color: '#222' },
  statLine: { fontSize: 7.5, color: '#333', marginTop: 1 },
  flagsLine: { fontSize: 7.5, color: '#a33', marginTop: 1 },
  subList: { fontSize: 7, color: '#555', marginLeft: 8, marginTop: 1 },
  summaryTable: { marginTop: 4 },
  summaryRow: { flexDirection: 'row', borderBottom: '0.5pt solid #ddd', paddingVertical: 2 },
  summaryCell: { fontSize: 8, flexGrow: 1 },
});

function n(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function FixedHeader({ snapshot }: { snapshot: SnapshotPayload }) {
  return (
    <View style={styles.fixedHeader} fixed>
      <Text style={styles.title}>Reabastecimiento en vivo — prueba de estado ({snapshot.bodega})</Text>
      <Text style={styles.metaLine}>
        Generado por {snapshot.autor} · {displayTimestamp(snapshot.createdAt)} · {snapshot.totalFilas} filas
      </Text>
      <Text style={styles.metaLine}>{describeFiltros(snapshot.filtros, snapshot.orden)}</Text>
    </View>
  );
}

function FixedFooter({ snapshot }: { snapshot: SnapshotPayload }) {
  return (
    <View style={styles.fixedFooter} fixed>
      <Text style={styles.footerText}>Snapshot {snapshot.id} · reabastecimiento_status_snapshots (inmutable)</Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
      />
    </View>
  );
}

function Portada({ snapshot }: { snapshot: SnapshotPayload }) {
  const sync = snapshot.meta.lastSync;
  return (
    <View>
      <Text style={styles.sectionTitle}>Frescura de los datos</Text>
      <Text style={styles.metaLine}>
        Corte (asOf): {snapshot.meta.asOf ?? 'sin dato'} · Mes: {snapshot.meta.month} ·
        Cobertura: {snapshot.meta.coberturaDias} días
      </Text>
      <Text style={styles.metaLine}>
        Última sincronización: {sync ? `${sync.status} · finalizó ${sync.finished_at ?? 'en curso'}` : 'sin registro'}
      </Text>

      <Text style={styles.sectionTitle}>KPIs (sobre la vista filtrada)</Text>
      <View style={styles.kpiRow}>
        <View style={styles.kpiBox}><Text style={styles.kpiValue}>{snapshot.kpis.total}</Text><Text style={styles.kpiLabel}>Filas visibles</Text></View>
        <View style={styles.kpiBox}><Text style={styles.kpiValue}>{snapshot.kpis.need}</Text><Text style={styles.kpiLabel}>Con sugerido {'>'} 0</Text></View>
        <View style={styles.kpiBox}><Text style={styles.kpiValue}>{n(snapshot.kpis.totSug)}</Text><Text style={styles.kpiLabel}>Total sugerido</Text></View>
        <View style={styles.kpiBox}><Text style={styles.kpiValue}>{snapshot.kpis.crit}</Text><Text style={styles.kpiLabel}>Críticos (DOH {'<'} 3)</Text></View>
      </View>

      <Text style={styles.sectionTitle}>En alza (sobre toda la bodega, sin filtrar)</Text>
      <Text style={styles.metaLine}>
        {snapshot.alza.creciente} en tendencia creciente · {snapshot.alza.noEvaluable} no evaluables ·
        {' '}{snapshot.alza.total} productos totales
      </Text>

      {snapshot.topProveedores.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Top proveedores por sugerido (sobre toda la bodega)</Text>
          <View style={styles.summaryTable}>
            {snapshot.topProveedores.map((tp) => (
              <View style={styles.summaryRow} key={tp.p}>
                <Text style={styles.summaryCell}>{tp.p}</Text>
                <Text style={styles.summaryCell}>Sugerido: {n(tp.sug)}</Text>
                <Text style={styles.summaryCell}>Críticos: {tp.crit}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {snapshot.tiendas.porTienda.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Tiendas (perímetro retail — G4, aparte de las bodegas de compra)</Text>
          <View style={styles.summaryTable}>
            {snapshot.tiendas.porTienda.map((t) => (
              <View style={styles.summaryRow} key={t.tienda}>
                <Text style={styles.summaryCell}>{t.tienda}</Text>
                <Text style={styles.summaryCell}>F6: {n(t.f6, 1)}</Text>
                <Text style={styles.summaryCell}>F3: {n(t.f3, 1)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.metaLine}>
            Total tiendas — F6: {n(snapshot.tiendas.total.f6, 1)} · F3: {n(snapshot.tiendas.total.f3, 1)} ·
            {' '}{snapshot.tiendas.productos} productos
          </Text>
        </>
      )}

      <Text style={styles.sectionTitle}>Detalle por producto ({snapshot.filas.length} filas)</Text>
    </View>
  );
}

function flagsActivos(f: SnapshotFila['flags']): string[] {
  const out: string[] = [];
  if (f.revisar) out.push('revisar');
  if (f.tendenciaCreciente) out.push('tendencia creciente');
  if (f.pendingUnknown) out.push('pendiente desconocido');
  if (f.seasonalLowConfidence) out.push('estacional baja confianza');
  if (f.seasonalExcluded) out.push('estacional excluido');
  if (f.sinReferenciaAnioAnterior) out.push('sin referencia año anterior');
  return out;
}

/** `wrap={false}`: the block never splits across a page break, so the
 * identifier (`cod · desc`) is always whole and on the same page as its data —
 * this is what satisfies D-9's "row identifier on every page" without needing
 * explicit continuation logic. */
function FilaBlock({ f }: { f: SnapshotFila }) {
  const flags = flagsActivos(f.flags);
  return (
    <View style={styles.block} wrap={false}>
      <View style={styles.blockHeader}>
        <Text style={styles.cod}>{f.cod} — {f.desc}</Text>
        <Text style={styles.desc}>{f.prov} · {f.cat} · ABC {f.abc}{f.purchaseOk ? '' : ' · NO COMPRABLE'}</Text>
      </View>

      <Text style={styles.statLine}>
        Existencia {n(f.exist)} (bruta {n(f.existencias)}, reservada {n(f.reserved)}) · Patio {n(f.patio)} ·
        {' '}Pendiente {f.pending === null ? 'desconocido' : n(f.pending)} · Tránsito {n(f.trans)}
        {f.transOverridden ? ' (capturado a mano)' : ''} · DOH {n(f.doh, 1)}
      </Text>
      <Text style={styles.statLine}>
        Sugerido {n(f.sug)} · Adicional {n(f.adic)} (comercial {n(f.adicComercial)}) ·
        {' '}Sugerido bodega {f.sugBodega === null ? '—' : n(f.sugBodega)} ·
        {' '}Destino {f.destino ?? 'sin declarar'}{f.destinoProvisional ? ' (provisional)' : ''}
      </Text>
      <Text style={styles.statLine}>
        Prom. 6m {n(f.p6)} · Prom. 3m {n(f.p3)} · Mismo mes año anterior {n(f.h)} · Ventana {f.win} ·
        {' '}MTD {f.mtd === null ? '—' : `${n(f.mtd)} en ${f.mtdDias} días (ritmo ${n(f.mtdRitmo)})`} ·
        {' '}Facturado F6 {f.f6 === null ? '—' : n(f.f6, 1)} / F3 {f.f3 === null ? '—' : n(f.f3, 1)}
      </Text>
      <Text style={styles.statLine}>
        Tendencia: {f.tendencia.estado}{f.tendencia.alzaPct !== null ? ` (${(f.tendencia.alzaPct * 100).toFixed(0)}%)` : ''}
        {f.tendencia.motivo ? ` — ${f.tendencia.motivo}` : ''} ·
        {' '}Alerta: {f.alerta.estado}{f.alerta.motivo ? ` — ${f.alerta.motivo}` : ''}
        {f.seasonalMotivo ? ` · Estacional: ${f.seasonalMotivo}` : ''}
      </Text>

      {f.transitoDetalle.length > 0 && (
        <Text style={styles.subList}>
          Entradas previstas: {f.transitoDetalle
            .map((d) => `${n(d.qty)}${d.fecha ? ` el ${d.fecha}` : ' sin fecha'}${d.orden ? ` (${d.orden})` : ''}`)
            .join(' · ')}
        </Text>
      )}
      {flags.length > 0 && <Text style={styles.flagsLine}>Señales: {flags.join(', ')}</Text>}
    </View>
  );
}

function ReabastecimientoStatusDocument({ snapshot }: { snapshot: SnapshotPayload }) {
  return (
    <Document
      title={reabastecimientoStatusFilename(snapshot)}
      author={snapshot.autor}
      subject={`Prueba de estado — Reabastecimiento en vivo — ${snapshot.bodega}`}
    >
      <Page size="A4" orientation="landscape" style={styles.page}>
        <FixedHeader snapshot={snapshot} />
        <Portada snapshot={snapshot} />
        {snapshot.filas.map((f) => <FilaBlock f={f} key={f.productId} />)}
        <FixedFooter snapshot={snapshot} />
      </Page>
    </Document>
  );
}

/** Renders the frozen snapshot to a PDF Blob, entirely client-side. */
export async function renderReabastecimientoStatusPdf(snapshot: SnapshotPayload): Promise<Blob> {
  return pdf(<ReabastecimientoStatusDocument snapshot={snapshot} />).toBlob();
}
