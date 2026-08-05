import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_VIEW_INVENTARIOS, getDefaultPage } from '@/lib/auth/roles';
import { VivoClient } from './VivoClient';

export const dynamic = 'force-dynamic';

/**
 * Modelo Reyma EN VIVO — phase-2 L2 (Inventarios silo / Alexis).
 *
 * Live Odoo data (ml/odoo_sync_reyma.py → reyma_* tables → /api/inventarios/
 * reyma) computed through the SAME phase-1 engine that proved 2,752/2,752
 * parity against Alexis' workbook. The replica page (/inventarios/reyma) stays
 * frozen as the parallel-run reference. Server-enforced RBAC:
 * CAN_VIEW_INVENTARIOS; the API route re-checks (defense in depth).
 */
export default async function ReymaVivoPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_INVENTARIOS)) redirect(getDefaultPage(user.role));

  return <VivoClient />;
}
