import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_VIEW_COMPRAS, getDefaultPage } from '@/lib/auth/roles';
import { HistorialClient } from './HistorialClient';

export const dynamic = 'force-dynamic';

/**
 * Historial de snapshots — past "Capturar" proofs of status for
 * reabastecimiento-vivo. Split out of the live page as its own destination
 * (2026-09-04): browsing history is navigation, not a toolbar action, so it
 * lives here and in the sidebar, not behind a dropdown next to Copiar/Exportar.
 *
 * Same RBAC as the parent page — CAN_VIEW_COMPRAS. Same posture on route
 * confinement: added to ROLLOUT_FOCUS['compras'] (lib/auth/roles.ts) since
 * that role is confined to an EXACT href list for the sidebar, not a prefix.
 */
export default async function HistorialPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_COMPRAS)) redirect(getDefaultPage(user.role));

  return <HistorialClient isSuperuser={user.role === 'superuser'} />;
}
