/**
 * Shared helpers for the Reyma write endpoints (L3). All writes are
 * append-only history rows with author attribution — latest row wins,
 * resolved at read time by the GET assembler.
 */
import { NextResponse } from 'next/server';
import { requireAuth, type AuthUser } from '@/lib/auth/server';
import { CAN_VIEW_INVENTARIOS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export function autor(user: AuthUser): string {
  return (user.displayName || user.email || 'desconocido').slice(0, 120);
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Auth + parse wrapper for the POST handlers: requireAuth(CAN_VIEW_INVENTARIOS),
 * JSON body parse, service client. Returns a Response early on failure.
 */
export async function withWriteAuth(
  request: Request,
): Promise<Response | { user: AuthUser; body: Record<string, unknown>; service: SupabaseClient }> {
  const auth = await requireAuth(CAN_VIEW_INVENTARIOS);
  if (auth instanceof Response) return auth;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest('Cuerpo JSON inválido');
  }
  return { user: auth, body, service: createServiceRoleClient() };
}

export async function insertRow(
  service: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
): Promise<NextResponse> {
  const { error } = await service.from(table).insert(row);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
