import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_VIEW_COMPRAS, getDefaultPage } from '@/lib/auth/roles';
import type { Dataset } from './engine';
import { ReabastecimientoClient } from './ReabastecimientoClient';
import rawData from './data.json';

export const dynamic = 'force-dynamic';

/**
 * Reabastecimiento — Wilmer's replenishment view (COMPRAS silo).
 *
 * Server-enforced RBAC: only CAN_VIEW_COMPRAS roles. Page-level role gating
 * lives here because the middleware only enforces authentication for pages
 * (per-route authz is applied to /api/* via check_route_access).
 *
 * DATA SOURCE (interim): a provenance-stamped snapshot derived from Wilmer's
 * MAYO2026.xlsx (SHA-256 8b51fe7d…), NOT live Odoo yet. This is the same
 * snapshot posture the rest of the app currently runs on; it will be replaced
 * by the live Odoo→Supabase sync (tracker batch B1) without changing this page
 * or the engine module.
 */
export default async function ReabastecimientoPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_COMPRAS)) redirect(getDefaultPage(user.role));

  return <ReabastecimientoClient data={rawData as unknown as Dataset} />;
}
