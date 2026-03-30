import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const supplierId = searchParams.get('supplier_id');
    const month = searchParams.get('month');

    // Single order detail with lines
    if (id) {
      const { data: order, error: orderError } = await supabase
        .from('open_orders')
        .select('*')
        .eq('id', Number(id))
        .single();

      if (orderError) throw orderError;

      const { data: lines, error: linesError } = await supabase
        .from('open_order_lines')
        .select('*, products(name, sku, cost)')
        .eq('open_order_id', Number(id));

      if (linesError) throw linesError;

      return NextResponse.json({ order, lines });
    }

    // List orders with optional filters
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

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const body = await request.json();
    const { open_order_id, lines } = body;

    if (!open_order_id || !Array.isArray(lines)) {
      return NextResponse.json(
        { error: 'Se requieren open_order_id y lines' },
        { status: 400 },
      );
    }

    // Delete existing lines for this order
    const { error: deleteError } = await supabase
      .from('open_order_lines')
      .delete()
      .eq('open_order_id', open_order_id);

    if (deleteError) throw deleteError;

    // Insert new lines
    const orderLines = lines.map(
      (line: { product_id: number; forecast_qty: number; unit_price: number }) => ({
        open_order_id,
        product_id: line.product_id,
        forecast_qty: line.forecast_qty,
        unit_price: line.unit_price,
      }),
    );

    const { data: newLines, error: linesError } = await supabase
      .from('open_order_lines')
      .insert(orderLines)
      .select('*, products(name, sku, cost)');

    if (linesError) throw linesError;

    // Recalculate totals on the header
    const total_forecast_qty = lines.reduce(
      (sum: number, l: { forecast_qty: number }) => sum + (l.forecast_qty || 0),
      0,
    );
    const total_forecast_value = lines.reduce(
      (sum: number, l: { forecast_qty: number; unit_price: number }) =>
        sum + (l.forecast_qty || 0) * (l.unit_price || 0),
      0,
    );

    const { data: updatedOrder, error: orderError } = await supabase
      .from('open_orders')
      .update({ total_forecast_qty, total_forecast_value })
      .eq('id', open_order_id)
      .select()
      .single();

    if (orderError) throw orderError;

    return NextResponse.json({ order: updatedOrder, lines: newLines });
  } catch (error) {
    console.error('OA open orders PATCH error:', error);
    return NextResponse.json(
      { error: 'Error al actualizar líneas de orden abierta' },
      { status: 500 },
    );
  }
}
