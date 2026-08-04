import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_VIEW_INVENTARIOS, getDefaultPage } from '@/lib/auth/roles';
import type { ReymaData } from './engine';
import { ReymaClient } from './ReymaClient';
import rawData from './data.json';

export const dynamic = 'force-dynamic';

/**
 * Modelo Reyma — phase-1 replica of Alexis' ADMINISTRACION INV REYMA workbook
 * (Inventarios silo). Server-enforced RBAC: only CAN_VIEW_INVENTARIOS roles.
 *
 * DATA SOURCE (interim, same posture as /compras/reabastecimiento): a
 * provenance-stamped extraction of Alexis' real July-2026 workbook (SHA-256 in
 * data.json.provenance), NOT live Odoo yet. Phase 2 swaps the data source for
 * the live Odoo sync without touching this page or the engine module. Parity:
 * 2,752/2,752 derived cells vs the frozen fixture (see __tests__/engine.test.ts).
 */
export default async function ReymaReplicaPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_INVENTARIOS)) redirect(getDefaultPage(user.role));

  return <ReymaClient data={rawData as unknown as ReymaData} />;
}
