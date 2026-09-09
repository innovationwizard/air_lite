import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_VIEW_COMPRAS_INTERNACIONALES, getDefaultPage } from '@/lib/auth/roles';
import { VivoClient } from './VivoClient';

export const dynamic = 'force-dynamic';

/**
 * Modelo Reyma EN VIVO — phase-2 L2 (Compras Internacionales silo / Alexis).
 *
 * Live Odoo data (ml/odoo_sync_reyma.py → reyma_* tables → /api/compras-internacionales/
 * reyma) computed through the SAME phase-1 engine that proved 2,752/2,752
 * parity against Alexis' workbook. The replica page (/compras-internacionales/reyma) stays
 * frozen as the parallel-run reference. Server-enforced RBAC:
 * CAN_VIEW_COMPRAS_INTERNACIONALES; the API route re-checks (defense in depth).
 */
export default async function ReymaVivoPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_COMPRAS_INTERNACIONALES)) redirect(getDefaultPage(user.role));

  return <VivoClient />;
}
