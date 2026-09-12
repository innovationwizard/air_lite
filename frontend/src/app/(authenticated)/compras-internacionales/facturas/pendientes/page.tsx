import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_VIEW_COMPRAS_INTERNACIONALES, getDefaultPage } from '@/lib/auth/roles';
import { PendientesClient } from './PendientesClient';

export const dynamic = 'force-dynamic';

/**
 * Facturas pendientes de REYMA — A12b (Compras Internacionales silo / Alexis).
 *
 * Sub-página de /compras-internacionales/facturas (viaja con su confinamiento de rol —
 * ver ROLLOUT_FOCUS / isWithinFocus en roles.ts, y PAGE_PERMISSIONS por
 * prefijo en middleware.ts: ninguna de las dos necesitó una entrada nueva).
 *
 * QUÉ ES: la cola de identificadores REYMA que no tienen SKU todavía
 * (`reyma_factura_pendiente`, migración 20260909000001). Antes del 2026-09-09
 * un identificador sin SKU bloqueaba la factura ENTERA — F173634/CH2PRXN. Ahora la
 * factura entra igual (la línea queda en cuarentena, `ml/reyma_factura_carga.py`)
 * y esta pantalla es donde Alexis la resuelve — sigue siendo él quien decide,
 * porque es quien conoce el producto, pero YA NO en el momento de descargar
 * el furgón. La resuelve cuando puede, y en cuanto lo hace, TODAS las líneas
 * que la estaban esperando (de cualquier factura) se cargan solas.
 */
export default async function FacturasPendientesPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_COMPRAS_INTERNACIONALES)) redirect(getDefaultPage(user.role));

  return <PendientesClient />;
}
