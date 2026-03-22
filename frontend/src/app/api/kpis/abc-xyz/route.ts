import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.rpc('rpc_abc_xyz_classification');

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('ABC/XYZ classification error:', error);
    return NextResponse.json(
      { error: 'Error al obtener clasificación ABC/XYZ' },
      { status: 500 },
    );
  }
}
