import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Supabase auth callback.
 *
 * Supabase-initiated email links (password reset, invite accept, email change,
 * magic link under PKCE flow) send the user back to this route with a short-
 * lived `code` query param. We exchange that code for a session cookie server-
 * side, then redirect the user to `next` (caller-controlled path) if present,
 * or to `/` otherwise.
 *
 * On any exchange failure (code expired, code already used, code mismatch),
 * the user lands on `/login` with a generic error — never leaking which of
 * those cases occurred.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

  // Only allow same-origin `next` redirects. Block absolute URLs to prevent
  // open-redirect abuse where an attacker crafts a link like
  // /auth/callback?code=xyz&next=https://evil.com.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin));
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL('/login?error=invalid_code', url.origin));
  }

  return NextResponse.redirect(new URL(safeNext, url.origin));
}
