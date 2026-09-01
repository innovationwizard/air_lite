import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { Role, isAuthorized } from './roles';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
  /** Canal comercial del jefe de área (rol `ventas`); null para el resto. */
  area: string | null;
}

/**
 * Get the authenticated user and their role from Supabase.
 * Returns null if not authenticated or no profile exists.
 * Use in API routes and server components.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const serviceClient = createServiceRoleClient();
  const { data: profile } = await serviceClient
    .from('user_profiles')
    .select('role, display_name, area')
    .eq('id', user.id)
    .single();

  if (!profile) return null;

  return {
    id: user.id,
    email: user.email ?? '',
    role: profile.role as Role,
    displayName: profile.display_name,
    area: profile.area ?? null,
  };
}

/**
 * Require authentication and authorization for an API route.
 * Returns the AuthUser if authorized, or a Response with 401/403 if not.
 */
export async function requireAuth(
  allowedRoles?: Role[],
): Promise<AuthUser | Response> {
  const user = await getAuthUser();

  if (!user) {
    return new Response(JSON.stringify({ error: 'No autenticado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (allowedRoles && !isAuthorized(user.role, allowedRoles)) {
    return new Response(JSON.stringify({ error: 'No autorizado', role: user.role }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return user;
}
