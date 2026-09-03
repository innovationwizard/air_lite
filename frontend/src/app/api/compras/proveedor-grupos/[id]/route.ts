export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_MANAGE_SUPPLIER_GROUPS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * PATCH/DELETE /api/compras/proveedor-grupos/[id] — editar o borrar un grupo.
 * Ver PROVEEDORES_GROUPING_BUILD_PLAN.md §2.2.
 */

/**
 * PATCH — body: { displayName?: string; supplierIds?: number[] }.
 *
 * `supplierIds`, si viene, REEMPLAZA el conjunto completo de miembros del
 * grupo (no un diff) — el panel siempre manda la lista completa que quiere,
 * así el contrato queda simple. Un id ya en OTRO grupo se MUEVE (mismo upsert
 * que POST); un id que estaba en este grupo y ya no viene en la lista se
 * quita.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(CAN_MANAGE_SUPPLIER_GROUPS);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json();
  const supabase = createServiceRoleClient();

  const { data: existing, error: findError } = await supabase
    .from('supplier_groups').select('id').eq('id', id).maybeSingle();
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Grupo no encontrado' }, { status: 404 });

  if (body.displayName !== undefined) {
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (!displayName) {
      return NextResponse.json({ error: 'Se requiere un nombre para el grupo' }, { status: 400 });
    }
    if (displayName.length > 255) {
      return NextResponse.json({ error: 'El nombre del grupo es demasiado largo' }, { status: 400 });
    }
    const { error: renameError } = await supabase
      .from('supplier_groups')
      .update({ display_name: displayName, updated_by: auth.id, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (renameError) return NextResponse.json({ error: renameError.message }, { status: 500 });
  }

  if (body.supplierIds !== undefined) {
    const supplierIds = Array.isArray(body.supplierIds) ? body.supplierIds : null;
    if (!supplierIds || !supplierIds.every((sid: unknown) => Number.isInteger(sid))) {
      return NextResponse.json({ error: 'supplierIds debe ser un arreglo de enteros' }, { status: 400 });
    }
    if (supplierIds.length > 0) {
      const { data: found, error: lookupError } = await supabase
        .from('suppliers').select('id').in('id', supplierIds);
      if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
      const foundIds = new Set((found ?? []).map((s: { id: number }) => s.id));
      const missing = supplierIds.filter((sid: number) => !foundIds.has(sid));
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Proveedores desconocidos: ${missing.join(', ')}` }, { status: 400 },
        );
      }
    }

    // Quitar del grupo a quien ya no está en la lista nueva.
    const { error: removeError } = await supabase
      .from('supplier_group_members')
      .delete()
      .eq('group_id', id)
      .not('supplier_id', 'in', `(${supplierIds.length > 0 ? supplierIds.join(',') : '0'})`);
    if (removeError) return NextResponse.json({ error: removeError.message }, { status: 500 });

    if (supplierIds.length > 0) {
      const { error: upsertError } = await supabase
        .from('supplier_group_members')
        .upsert(
          supplierIds.map((sid: number) => ({ supplier_id: sid, group_id: id, added_at: new Date().toISOString() })),
          { onConflict: 'supplier_id' },
        );
      if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  const { data: updated, error: reloadError } = await supabase
    .from('supplier_groups').select('id, display_name').eq('id', id).single();
  if (reloadError || !updated) {
    return NextResponse.json({ error: reloadError?.message ?? 'Error recargando el grupo' }, { status: 500 });
  }

  return NextResponse.json({ id: updated.id, displayName: updated.display_name });
}

/** DELETE — borra el grupo; sus miembros vuelven a "sin agrupar" (ON DELETE CASCADE). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(CAN_MANAGE_SUPPLIER_GROUPS);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const supabase = createServiceRoleClient();

  const { error } = await supabase.from('supplier_groups').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
