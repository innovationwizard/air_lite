import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const runIdParam = req.nextUrl.searchParams.get('run_id');
    const scopeParam = req.nextUrl.searchParams.get('scope');

    const runId = runIdParam ? Number(runIdParam) : null;
    const carvajalReymaOnly = scopeParam !== 'all';

    if (runId === null) {
      const { data, error } = await supabase.rpc('rpc_gerencia_validation_runs');
      if (error) throw error;
      return NextResponse.json({ runs: data ?? [] });
    }

    if (!Number.isInteger(runId) || runId <= 0) {
      return NextResponse.json({ error: 'run_id inválido' }, { status: 400 });
    }

    const rows: unknown[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .rpc('rpc_gerencia_validation', {
          p_run_id: runId,
          p_carvajal_reyma_only: carvajalReymaOnly,
        })
        .range(from, to);

      if (error) throw error;
      if (!data || data.length === 0) break;

      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }

    return NextResponse.json({ rows });
  } catch (error) {
    console.error('Gerencia validacion error:', error);
    return NextResponse.json(
      { error: 'Error al obtener la validación de gerencia' },
      { status: 500 },
    );
  }
}
