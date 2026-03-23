export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_MANAGE_USERS, Role } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';

const VALID_ROLES: Role[] = ['admin', 'gerencia', 'compras', 'ventas', 'inventario', 'financiero'];

/** GET /api/admin/users — list all users with profiles */
export async function GET() {
  const authResult = await requireAuth(CAN_MANAGE_USERS);
  if (authResult instanceof Response) return authResult;

  const supabase = createServiceRoleClient();

  // Get all user profiles
  const { data: profiles, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, display_name, role, created_at')
    .order('created_at', { ascending: false });

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  // Get auth user details (email, last sign in)
  const { data: { users: authUsers }, error: authError } = await supabase.auth.admin.listUsers();

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // Merge profiles with auth data
  const authMap = new Map(authUsers.map((u) => [u.id, u]));
  const users = (profiles ?? []).map((p) => {
    const authUser = authMap.get(p.id);
    return {
      id: p.id,
      email: authUser?.email ?? '',
      displayName: p.display_name,
      role: p.role,
      createdAt: p.created_at,
      lastSignIn: authUser?.last_sign_in_at ?? null,
    };
  });

  return NextResponse.json(users);
}

/** POST /api/admin/users — create a new user */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(CAN_MANAGE_USERS);
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { email, password, displayName, role } = body;

  // Validation
  if (!email || !password || !role) {
    return NextResponse.json(
      { error: 'Se requieren email, contraseña y rol' },
      { status: 400 },
    );
  }

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `Rol inválido. Roles permitidos: ${VALID_ROLES.join(', ')}` },
      { status: 400 },
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'La contraseña debe tener al menos 8 caracteres' },
      { status: 400 },
    );
  }

  // Superuser role cannot be assigned via this endpoint
  if (role === 'superuser') {
    return NextResponse.json(
      { error: 'El rol superuser no puede ser asignado desde esta interfaz' },
      { status: 403 },
    );
  }

  const supabase = createServiceRoleClient();

  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  // Create profile
  const { error: profileError } = await supabase
    .from('user_profiles')
    .insert({
      id: authData.user.id,
      display_name: displayName ?? null,
      role,
    });

  if (profileError) {
    // Rollback: delete auth user if profile creation fails
    await supabase.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  return NextResponse.json({
    id: authData.user.id,
    email,
    displayName,
    role,
  }, { status: 201 });
}

/** DELETE /api/admin/users?id=<uuid> — delete a user */
export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(CAN_MANAGE_USERS);
  if (authResult instanceof Response) return authResult;

  const userId = request.nextUrl.searchParams.get('id');
  if (!userId) {
    return NextResponse.json({ error: 'Se requiere el parámetro id' }, { status: 400 });
  }

  // Prevent self-deletion
  if (userId === authResult.id) {
    return NextResponse.json({ error: 'No puede eliminar su propia cuenta' }, { status: 403 });
  }

  const supabase = createServiceRoleClient();

  // Check target user's role — cannot delete superuser
  const { data: targetProfile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (targetProfile?.role === 'superuser') {
    return NextResponse.json({ error: 'No se puede eliminar un superusuario' }, { status: 403 });
  }

  // Delete profile first (FK constraint), then auth user
  await supabase.from('user_profiles').delete().eq('id', userId);
  const { error } = await supabase.auth.admin.deleteUser(userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
