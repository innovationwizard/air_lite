export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_MANAGE_SUPPLIER_GROUPS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * GET/POST /api/compras/proveedor-grupos — grupos de proveedores para el
 * filtro de reabastecimiento-vivo. Ver PROVEEDORES_GROUPING_BUILD_PLAN.md §2.
 *
 * RBAC: defense-in-depth — middleware `check_route_access` (route_permissions,
 * migración 20260904000001) + in-handler requireAuth(CAN_MANAGE_SUPPLIER_GROUPS).
 * Wilmer-only por diseño (compras), no CAN_VIEW_COMPRAS entero.
 */

interface GroupRow { id: string; display_name: string }
interface MemberRow { supplier_id: number; group_id: string; suppliers: { id: number; name: string } | null }
interface SupplierRow { id: number; name: string }

/** GET — todos los grupos con sus miembros resueltos, y los proveedores sueltos. */
export async function GET() {
  const auth = await requireAuth(CAN_MANAGE_SUPPLIER_GROUPS);
  if (auth instanceof Response) return auth;

  const supabase = createServiceRoleClient();

  const [{ data: groups, error: groupsError }, { data: members, error: membersError },
         { data: allSuppliers, error: suppliersError }] = await Promise.all([
    supabase.from('supplier_groups').select('id, display_name').order('display_name'),
    supabase.from('supplier_group_members')
      .select('supplier_id, group_id, suppliers(id, name)'),
    supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
  ]);

  if (groupsError) return NextResponse.json({ error: groupsError.message }, { status: 500 });
  if (membersError) return NextResponse.json({ error: membersError.message }, { status: 500 });
  if (suppliersError) return NextResponse.json({ error: suppliersError.message }, { status: 500 });

  const membersByGroup = new Map<string, { id: number; name: string }[]>();
  const groupedSupplierIds = new Set<number>();
  for (const m of (members ?? []) as unknown as MemberRow[]) {
    if (!m.suppliers) continue;
    groupedSupplierIds.add(m.supplier_id);
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push({ id: m.suppliers.id, name: m.suppliers.name });
    membersByGroup.set(m.group_id, list);
  }

  const result = {
    groups: ((groups ?? []) as GroupRow[]).map((g) => ({
      id: g.id,
      displayName: g.display_name,
      members: (membersByGroup.get(g.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    })),
    ungrouped: ((allSuppliers ?? []) as SupplierRow[])
      .filter((s) => !groupedSupplierIds.has(s.id)),
  };

  return NextResponse.json(result);
}

/** POST — crear un grupo con un nombre y al menos un miembro. */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(CAN_MANAGE_SUPPLIER_GROUPS);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const supplierIds = Array.isArray(body.supplierIds) ? body.supplierIds : null;

  if (!displayName) {
    return NextResponse.json({ error: 'Se requiere un nombre para el grupo' }, { status: 400 });
  }
  if (displayName.length > 255) {
    return NextResponse.json({ error: 'El nombre del grupo es demasiado largo' }, { status: 400 });
  }
  // Un grupo sin miembros no tiene efecto en el filtro y solo ensucia el
  // panel — el panel debe evitar este estado desde la UI (checkbox mínimo 1),
  // pero la API es la última línea de defensa.
  if (!supplierIds || supplierIds.length === 0
      || !supplierIds.every((id: unknown) => Number.isInteger(id))) {
    return NextResponse.json(
      { error: 'Se requiere al menos un proveedor (supplierIds)' }, { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  const { data: found, error: lookupError } = await supabase
    .from('suppliers').select('id').in('id', supplierIds);
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
  const foundIds = new Set((found ?? []).map((s: { id: number }) => s.id));
  const missing = supplierIds.filter((id: number) => !foundIds.has(id));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Proveedores desconocidos: ${missing.join(', ')}` }, { status: 400 },
    );
  }

  const { data: group, error: insertError } = await supabase
    .from('supplier_groups')
    .insert({ display_name: displayName, created_by: auth.id, updated_by: auth.id })
    .select('id, display_name')
    .single();
  if (insertError || !group) {
    return NextResponse.json({ error: insertError?.message ?? 'Error creando el grupo' }, { status: 500 });
  }

  // Upsert = MOVER: un proveedor que ya estaba en otro grupo pasa a este.
  // El cliente es responsable de advertir esto antes de enviar (ver panel);
  // la API solo garantiza que el estado final sea el correcto.
  const { error: membersError } = await supabase
    .from('supplier_group_members')
    .upsert(
      supplierIds.map((id: number) => ({ supplier_id: id, group_id: group.id, added_at: new Date().toISOString() })),
      { onConflict: 'supplier_id' },
    );
  if (membersError) {
    // Rollback: no dejar un grupo vacío huérfano si los miembros fallaron.
    await supabase.from('supplier_groups').delete().eq('id', group.id);
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  return NextResponse.json({
    id: group.id,
    displayName: group.display_name,
    members: supplierIds,
  }, { status: 201 });
}
