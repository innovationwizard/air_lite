export const dynamic = 'force-dynamic';

import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_SYSTEM } from '@/lib/auth/roles';
import { NextResponse } from 'next/server';

export async function GET() {
  const authResult = await requireAuth(CAN_VIEW_SYSTEM);
  if (authResult instanceof Response) return authResult;

  const mlUrl = process.env.ML_SERVICE_URL;
  if (!mlUrl) {
    return NextResponse.json({ error: 'ML_SERVICE_URL not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(`${mlUrl}/health`, {
      headers: { 'X-API-Key': process.env.ML_SERVICE_API_KEY ?? '' },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ status: 'error', error: 'No se pudo conectar' }, { status: 502 });
  }
}
