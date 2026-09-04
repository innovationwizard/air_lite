import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_MANAGE_SUPPLIER_GROUPS, getDefaultPage } from '@/lib/auth/roles';
import { ProveedoresClient } from './ProveedoresClient';

export const dynamic = 'force-dynamic';

/**
 * Grupos de proveedores as its own destination (Jorge, 2026-09-04) — this
 * management panel already existed (ProveedorGruposPanel.tsx, opened from a
 * "Gestionar" link inside the proveedor filter on the live page) but had no
 * URL of its own, so it wasn't reachable from the sidebar. That trigger
 * stays as-is; this page is an additional way in, for a direct nav item.
 *
 * Narrower RBAC than the parent page: CAN_MANAGE_SUPPLIER_GROUPS
 * (superuser + compras), not CAN_VIEW_COMPRAS — see the PAGE_PERMISSIONS
 * entry in lib/auth/roles.ts for why that needs its own explicit rule.
 */
export default async function ProveedoresPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_MANAGE_SUPPLIER_GROUPS)) redirect(getDefaultPage(user.role));

  return <ProveedoresClient />;
}
