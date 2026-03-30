import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get('supplier_id');
    const month = searchParams.get('month');

    let query = supabase.from('open_orders').select('*');

    if (supplierId) {
      query = query.eq('supplier_id', Number(supplierId));
    }
    if (month) {
      query = query.eq('month', month);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('OA open orders GET error:', error);
    return NextResponse.json(
      { error: 'Error al obtener órdenes abiertas' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const body = await request.json();
    const { supplier_id, month, lines, notes } = body;

    if (!supplier_id || !month) {
      return NextResponse.json(
        { error: 'Se requieren supplier_id y month' },
        { status: 400 },
      );
    }

    const safeLines = Array.isArray(lines) ? lines : [];

    const total_forecast_qty = safeLines.reduce(
      (sum: number, l: { forecast_qty: number }) => sum + (l.forecast_qty || 0),
      0,
    );
    const total_forecast_value = safeLines.reduce(
      (sum: number, l: { forecast_qty: number; unit_price: number }) =>
        sum + (l.forecast_qty || 0) * (l.unit_price || 0),
      0,
    );

    const { data: order, error: orderError } = await supabase
      .from('open_orders')
      .insert({
        supplier_id,
        month,
        total_forecast_qty,
        total_forecast_value,
        notes: notes || null,
      })
      .select()
      .single();

    if (orderError) throw orderError;

    let createdLines = null;
    if (safeLines.length > 0) {
      const orderLines = safeLines.map(
        (line: { product_id: number; forecast_qty: number; unit_price: number }) => ({
          open_order_id: order.id,
          product_id: line.product_id,
          forecast_qty: line.forecast_qty,
          unit_price: line.unit_price,
        }),
      );

      const { data: linesData, error: linesError } = await supabase
        .from('open_order_lines')
        .insert(orderLines)
        .select();

      if (linesError) throw linesError;
      createdLines = linesData;
    }

    return NextResponse.json(
      { ...order, lines: createdLines || [] },
      { status: 201 },
    );
  } catch (error) {
    console.error('OA open orders POST error:', error);
    return NextResponse.json(
      { error: 'Error al crear orden abierta' },
      { status: 500 },
    );
  }
}
