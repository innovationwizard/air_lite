import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    if (type === 'unloading') {
      const { data, error } = await supabase
        .from('unloading_times')
        .select('*');

      if (error) throw error;

      return NextResponse.json(data);
    }

    const { data, error } = await supabase
      .from('warehouse_config')
      .select('*');

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Warehouse config GET error:', error);
    return NextResponse.json(
      { error: 'Error al obtener configuración de almacén' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID requerido' }, { status: 400 });
    }

    const table = type === 'unloading' ? 'unloading_times' : 'warehouse_config';
    const { error } = await supabase.from(table).delete().eq('id', Number(id));

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Warehouse config DELETE error:', error);
    return NextResponse.json(
      { error: 'Error al eliminar registro' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const body = await request.json();

    if (type === 'unloading') {
      const { data, error } = await supabase
        .from('unloading_times')
        .upsert(body)
        .select();

      if (error) throw error;

      return NextResponse.json(data);
    }

    const {
      warehouse_label,
      num_docks,
      working_hours_start,
      working_hours_end,
      max_capacity_m3,
      dock_cleanup_minutes,
      overtime_threshold,
    } = body;

    const { data, error } = await supabase
      .from('warehouse_config')
      .upsert({
        warehouse_label,
        num_docks,
        working_hours_start,
        working_hours_end,
        max_capacity_m3,
        dock_cleanup_minutes,
        overtime_threshold,
      })
      .select();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Warehouse config POST error:', error);
    return NextResponse.json(
      { error: 'Error al guardar configuración de almacén' },
      { status: 500 },
    );
  }
}
