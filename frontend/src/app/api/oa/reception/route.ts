import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const p_date = dateParam || new Date().toISOString().split('T')[0];

    const warehouseParam = searchParams.get('warehouse_id');
    const p_warehouse_id = warehouseParam ? Number(warehouseParam) : null;

    const { data, error } = await supabase.rpc('rpc_oa_reception_saturation', {
      p_date,
      p_warehouse_id,
    });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('OA reception error:', error);
    return NextResponse.json(
      { error: 'Error al obtener saturación de recepción' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const body = await request.json();
    const {
      id,
      warehouse_id,
      supplier_id,
      scheduled_date,
      scheduled_time,
      unit_type,
      estimated_unload_hours,
      notes,
      status,
      started_at,
      completed_at,
      dock_assigned,
      priority,
      hot_list_products,
    } = body;

    let record;

    if (id) {
      // Update existing reception_schedule entry
      const { data, error } = await supabase
        .from('reception_schedule')
        .update({
          warehouse_id,
          supplier_id,
          scheduled_date,
          scheduled_time: scheduled_time || null,
          unit_type,
          estimated_unload_hours: estimated_unload_hours || null,
          notes: notes || null,
          status: status || undefined,
          started_at: started_at || null,
          completed_at: completed_at || null,
          dock_assigned: dock_assigned || null,
          priority: priority || null,
          hot_list_products: hot_list_products || null,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      record = data;
    } else {
      // Insert new reception_schedule entry
      const { data, error } = await supabase
        .from('reception_schedule')
        .insert({
          warehouse_id,
          supplier_id,
          scheduled_date,
          scheduled_time: scheduled_time || null,
          unit_type,
          estimated_unload_hours: estimated_unload_hours || null,
          notes: notes || null,
          status: status || 'scheduled',
          started_at: started_at || null,
          completed_at: completed_at || null,
          dock_assigned: dock_assigned || null,
          priority: priority || null,
          hot_list_products: hot_list_products || null,
        })
        .select()
        .single();

      if (error) throw error;
      record = data;
    }

    // Auto-recalculate unload time averages when a reception is completed
    if (status === 'completed' && started_at && completed_at) {
      await supabase.rpc('rpc_oa_recalc_unload_times');
    }

    return NextResponse.json(record, { status: id ? 200 : 201 });
  } catch (error) {
    console.error('OA reception POST error:', error);
    return NextResponse.json(
      { error: 'Error al gestionar recepción' },
      { status: 500 },
    );
  }
}
