import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_VIEW_INVENTARIOS, getDefaultPage } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { DIAS_HABILES_DEFAULT } from '../reyma-vivo/eta';
import { FacturasClient } from './FacturasClient';

export const dynamic = 'force-dynamic';

/**
 * Cargar facturas de REYMA — A12 (Inventarios silo / Alexis).
 *
 * Página PROPIA y pensada para el teléfono, no una pestaña de `reyma-vivo`.
 * En el momento en que Alexis tiene la factura en la mano está en WhatsApp, en
 * su teléfono; `reyma-vivo` es una tabla densa de escritorio, excelente para su
 * trabajo de análisis e imposible de usar con un pulgar. Pedirle que cambie de
 * dispositivo justo cuando la fricción tiene que ser cero es lo que hace que el
 * ETA se pierda.
 *
 * RBAC del lado del servidor: CAN_VIEW_INVENTARIOS. Los dos endpoints
 * re-verifican (defensa en profundidad) y `route_permissions` los cubre.
 */
export default async function FacturasPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_INVENTARIOS)) redirect(getDefaultPage(user.role));

  // Días hábiles por bodega para la «ETA App». Append-only, la última fila por
  // destino manda — mismo resolutor que usa el GET del modelo vivo.
  const service = createServiceRoleClient();
  const { data } = await service
    .from('reyma_eta_config')
    .select('destino, dias_habiles, created_at')
    .order('created_at', { ascending: false });

  const porDestino: Record<string, number> = {};
  for (const c of data ?? []) {
    if (porDestino[c.destino] === undefined) porDestino[c.destino] = c.dias_habiles;
  }

  return <FacturasClient etaConfig={{ porDestino, default: DIAS_HABILES_DEFAULT }} />;
}
