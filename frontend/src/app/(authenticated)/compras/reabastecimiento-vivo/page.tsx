import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_VIEW_COMPRAS, getDefaultPage } from '@/lib/auth/roles';
import { VivoClient } from './VivoClient';

export const dynamic = 'force-dynamic';

/**
 * Reabastecimiento EN VIVO — the live-Odoo replenishment view (COMPRAS silo).
 *
 * Data path: Odoo → ml sync → reabastecimiento_inputs →
 * GET /api/compras/reabastecimiento (engine.ts applied server-side, override
 * streams merged) → this page. Write-backs: inline Tránsito and Pendiente
 * fields POST to /transito and /pendiente (append-only, authored).
 *
 * Server-enforced RBAC (CAN_VIEW_COMPRAS) — the middleware only authenticates
 * pages; per-route authz for the API calls is enforced separately via
 * check_route_access (route_permissions).
 *
 * The xlsx snapshot page (/compras/reabastecimiento) stays untouched as the
 * parity reference; this page replaces it once parallel-run passes (B7).
 */
export default async function ReabastecimientoVivoPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_COMPRAS)) redirect(getDefaultPage(user.role));

  return <VivoClient />;
}
