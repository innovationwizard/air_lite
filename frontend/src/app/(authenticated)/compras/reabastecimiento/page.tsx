import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_EDIT_REABASTECIMIENTO, CAN_VIEW_COMPRAS, getDefaultPage } from '@/lib/auth/roles';
import { VivoClient } from './VivoClient';

export const dynamic = 'force-dynamic';

/**
 * Reabastecimiento EN VIVO — the live-Odoo replenishment view (COMPRAS silo).
 *
 * Data path: Odoo → ml sync → reabastecimiento_inputs →
 * GET /api/compras/reabastecimiento (shared engine applied server-side, override
 * streams merged) → this page. Write-backs: inline Tránsito and Pendiente
 * fields POST to /transito and /pendiente (append-only, authored).
 *
 * Server-enforced RBAC (CAN_VIEW_COMPRAS) — the middleware only authenticates
 * pages; per-route authz for the API calls is enforced separately via
 * check_route_access (route_permissions).
 */
export default async function ReabastecimientoVivoPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_COMPRAS)) redirect(getDefaultPage(user.role));

  // Quien ve pero no escribe (ceo) recibe la tabla sin casillas ni snapshot.
  return <VivoClient soloLectura={!isAuthorized(user.role, CAN_EDIT_REABASTECIMIENTO)} />;
}
