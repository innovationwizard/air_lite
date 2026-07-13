import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Page routes reachable without a valid auth session. Everything else
// requires an authenticated Supabase user cookie; callers without one get
// bounced to /login. The password-recovery flow includes three paths here:
//   - /forgot-password         : user requests the reset email (no session)
//   - /auth/callback           : Supabase email link lands here; the route
//                                 handler itself creates the session from the
//                                 one-time `code` param before redirecting on
//   - /update-password is NOT here — once the callback has seated the session,
//                                 the user is authenticated and the standard
//                                 auth gate applies.
const PUBLIC_PAGE_ROUTES = ['/login', '/health', '/forgot-password', '/auth/callback'];

// API routes reachable without a valid auth session. Intentionally narrow —
// per the 2026-04-23 auth-hardening plan, every other /api/* requires a
// Supabase session cookie. See docs/security/PLAN_API_AUTH_DEFENSE_IN_DEPTH.md
// Phase 0.
//   - /api/health        : Vercel / monitoring health checks
//   - /api/auth/callback : Supabase email confirmation callback
const PUBLIC_API_ROUTES = ['/api/health', '/api/auth/callback'];

function isPublic(pathname: string): boolean {
  if (pathname.startsWith('/api/')) {
    return PUBLIC_API_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));
  }
  return PUBLIC_PAGE_ROUTES.some((r) => pathname.startsWith(r));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allowlist exact public routes — narrow, no wildcard /api/* bypass
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No session. API callers get 401 JSON; page callers get redirected to /login.
  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'No autenticado' },
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Redirect authenticated users away from login
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/backtest', request.url));
  }

  // Per-route permission check for /api/* via the route_permissions matrix.
  // The user's policy is the single source of truth:
  //   - Data:  route_permissions table (role × route_pattern × methods)
  //   - Code:  check_route_access(user_id, route, method) RPC — superuser
  //            bypass + glob pattern matching + methods[] check
  // See docs/security/PLAN_API_AUTH_DEFENSE_IN_DEPTH.md Phase 1.
  if (pathname.startsWith('/api/')) {
    const { data: allowed, error } = await supabase.rpc('check_route_access', {
      p_user_id: user.id,
      p_route: pathname,
      p_method: request.method,
    });
    if (error) {
      console.error('[middleware] check_route_access failed:', error);
      return NextResponse.json(
        { error: 'Error verificando permisos' },
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (!allowed) {
      return NextResponse.json(
        { error: 'No autorizado', route: pathname, method: request.method },
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
