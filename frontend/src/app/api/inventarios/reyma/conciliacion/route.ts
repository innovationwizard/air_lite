import { NextResponse } from 'next/server';
import { conciliar, type DecisionPersistida } from '@/app/(authenticated)/inventarios/reyma-vivo/conciliacion';
import type { FacturaLinea, FacturaPdfLinea } from '@/app/(authenticated)/inventarios/reyma-vivo/types';
import { autor, badRequest, insertRow, withWriteAuth } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventarios/reyma/conciliacion — N14.
 *
 * Dos acciones sobre `reyma_factura_match` (tabla append-only, la última fila
 * por par manda):
 *
 *   { accion: 'ejecutar', mes: 'YYYY-MM' }
 *     Corre el motor sobre los datos actuales y PERSISTE los enlaces que
 *     propuso (tier 1 y 2) con su evidencia. Idempotente: si el enlace ya está
 *     con el mismo estado y tier, no escribe otra fila. Lo llama la página y
 *     también `scripts/load_reyma_facturas_pdf.py` después de cada carga.
 *
 *   { accion: 'decidir', folioFiscal, odooFactura, estado: 'confirmado'|'rechazado', nota? }
 *     Decisión humana sobre un caso de la cola de excepciones. Gana siempre
 *     sobre el motor: 'confirmado' fuerza el enlace, 'rechazado' lo veta.
 *
 * El motor vive en `conciliacion.ts` (puro, testeado). Acá sólo hay I/O.
 */

interface MatchRowDb {
  folio_fiscal: string;
  factura: string;
  odoo_factura: string;
  tier: number;
  regla: string;
  estado: string;
  autor: string;
  created_at: string;
}

/** Última fila por par (la consulta viene ordenada por created_at DESC). */
function decisionesVigentes(filas: MatchRowDb[]): DecisionPersistida[] {
  const vistos = new Set<string>();
  const out: DecisionPersistida[] = [];
  for (const r of filas) {
    const k = `${r.folio_fiscal}|${r.odoo_factura}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push({
      folioFiscal: r.folio_fiscal,
      odooFactura: r.odoo_factura,
      estado: r.estado as DecisionPersistida['estado'],
      tier: r.tier as DecisionPersistida['tier'],
      regla: r.regla,
      autor: r.autor,
      fecha: r.created_at,
    });
  }
  return out;
}

const MES_RE = /^\d{4}-\d{2}$/;

export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { user, body, service } = ctx;
  const accion = typeof body.accion === 'string' ? body.accion : '';

  // ── Decisión humana sobre un caso de la cola.
  if (accion === 'decidir') {
    const folioFiscal = typeof body.folioFiscal === 'string' ? body.folioFiscal.trim() : '';
    const odooFactura = typeof body.odooFactura === 'string' ? body.odooFactura.trim() : '';
    const factura = typeof body.factura === 'string' ? body.factura.trim() : '';
    const estado = body.estado;
    const mes = typeof body.mes === 'string' ? body.mes : '';
    if (!folioFiscal || !odooFactura || !factura) {
      return badRequest('folioFiscal, factura y odooFactura son obligatorios');
    }
    if (estado !== 'confirmado' && estado !== 'rechazado') {
      return badRequest("estado debe ser 'confirmado' o 'rechazado'");
    }
    if (!MES_RE.test(mes)) return badRequest("mes debe tener formato 'YYYY-MM'");
    const nota = typeof body.nota === 'string' && body.nota.trim() ? ` — ${body.nota.trim()}` : '';
    return insertRow(service, 'reyma_factura_match', {
      folio_fiscal: folioFiscal,
      factura,
      odoo_factura: odooFactura,
      mes: `${mes}-01`,
      tier: 0,
      regla: `decisión manual (${estado})`,
      estado,
      evidencia: { origen: 'humano', nota: nota.trim() || null },
      autor: `${autor(user)}${nota}`,
    });
  }

  if (accion !== 'ejecutar') {
    return badRequest("accion debe ser 'ejecutar' o 'decidir'");
  }

  // ── Correr el motor y persistir lo que propone.
  const mes = typeof body.mes === 'string' ? body.mes : '';
  if (!MES_RE.test(mes)) return badRequest("mes debe tener formato 'YYYY-MM'");

  // El lado Odoo se reemplaza por sync: hay que usar el run más reciente, si no
  // se conciliaría contra filas viejas.
  // `kind = 'reyma'` NO es opcional: en el mismo `sync_runs` conviven las
  // corridas de reabastecimiento, que suelen ser las más recientes. Sin el
  // filtro se tomaría un sync_id sin filas en `reyma_facturas` y la
  // conciliación no encontraría nada — un no-op silencioso, justo lo que no
  // queremos. Mismo filtro que usa el GET del modelo vivo.
  const { data: runRows, error: runErr } = await service
    .from('sync_runs').select('id')
    .eq('kind', 'reyma')
    .eq('status', 'success').order('started_at', { ascending: false }).limit(1);
  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 });
  const runId = runRows?.[0]?.id;
  if (!runId) return badRequest('no hay ninguna sincronización exitosa contra la cual conciliar');

  const [odooRes, pdfRes, matchRes] = await Promise.all([
    service.from('reyma_facturas')
      .select('factura, fecha, referencia, tipo, codigo, cantidad, precio_unit')
      .eq('sync_id', runId),
    service.from('reyma_facturas_pdf')
      .select('folio_fiscal, factura, guia, destino, fecha, eta, codigo, clave, cantidad, precio_unit'),
    service.from('reyma_factura_match')
      .select('folio_fiscal, factura, odoo_factura, tier, regla, estado, autor, created_at')
      .eq('mes', `${mes}-01`).order('created_at', { ascending: false }),
  ]);
  for (const r of [odooRes, pdfRes, matchRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }

  const odooFacturas: FacturaLinea[] = (odooRes.data ?? []).map((f) => ({
    factura: f.factura, fecha: f.fecha, referencia: f.referencia,
    tipo: f.tipo as FacturaLinea['tipo'], codigo: f.codigo,
    cantidad: Number(f.cantidad), precioUnit: Number(f.precio_unit),
  }));
  const pdfFacturas: FacturaPdfLinea[] = (pdfRes.data ?? []).map((f) => ({
    folioFiscal: f.folio_fiscal, factura: f.factura, guia: f.guia, destino: f.destino,
    fecha: f.fecha, eta: f.eta, codigo: f.codigo, clave: f.clave,
    cantidad: Number(f.cantidad), precioUnit: Number(f.precio_unit),
  }));
  const previas = decisionesVigentes((matchRes.data ?? []) as MatchRowDb[]);
  const res = conciliar(odooFacturas, pdfFacturas, mes, previas);

  // Persistir sólo lo NUEVO: si el par ya está vigente con el mismo estado y
  // tier, no se agrega otra fila (la tabla es historial, no bitácora de
  // corridas — no queremos una fila por cada vez que alguien abre la página).
  const yaVigente = new Map(previas.map((d) => [`${d.folioFiscal}|${d.odooFactura}`, d]));
  const nuevas = res.enlaces
    .filter((e) => !e.humano)
    .filter((e) => {
      const v = yaVigente.get(`${e.folioFiscal}|${e.odooFactura}`);
      return !v || v.estado !== 'auto' || v.tier !== e.tier;
    })
    .map((e) => ({
      folio_fiscal: e.folioFiscal,
      factura: e.factura,
      odoo_factura: e.odooFactura,
      mes: `${mes}-01`,
      tier: e.tier,
      regla: e.regla,
      estado: 'auto',
      evidencia: e.evidencia,
      autor: `motor de conciliación (tier ${e.tier}), corrido por ${autor(user)}`,
    }));

  if (nuevas.length) {
    const { error } = await service.from('reyma_factura_match').insert(nuevas);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    mes,
    enlacesNuevos: nuevas.length,
    enlacesVigentes: res.enlaces.length,
    excepciones: res.excepciones.length,
    odooSinPdf: res.odooSinPdf,
    pdfSinOdoo: res.pdfSinOdoo.length,
  });
}
