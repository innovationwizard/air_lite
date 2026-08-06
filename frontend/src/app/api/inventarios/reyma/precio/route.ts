import { NextResponse } from 'next/server';
import { autor, badRequest, withWriteAuth } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventarios/reyma/precio — precio de compra editable (C2, Alexis:
 * "si vos cambias aquí a 13, del otro lado te va a cambiar a 13").
 * Inserts append-only history AND updates the current value in
 * reyma_products.precio_factura — single source read by the GET, the NC/price
 * checks and the sync's price alerts.
 * Body: { codigo: string, precio: number (> 0) }
 */
export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { user, body, service } = ctx;

  const codigo = typeof body.codigo === 'string' ? body.codigo.trim() : '';
  const precio = body.precio;
  if (!codigo) return badRequest('codigo requerido');
  if (typeof precio !== 'number' || !isFinite(precio) || precio <= 0 || precio > 100000) {
    return badRequest('precio debe ser un número > 0');
  }
  const { error: histErr } = await service
    .from('reyma_precio_overrides')
    .insert({ codigo, precio, autor: autor(user) });
  if (histErr) return NextResponse.json({ error: histErr.message }, { status: 500 });

  const { error: updErr } = await service
    .from('reyma_products')
    .update({ precio_factura: precio, updated_at: new Date().toISOString() })
    .eq('codigo', codigo);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
