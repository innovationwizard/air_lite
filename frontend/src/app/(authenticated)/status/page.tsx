import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_VIEW_STATUS, CAN_EDIT_STATUS_PLAN, getDefaultPage } from '@/lib/auth/roles';
import { StatusClient } from './StatusClient';

export const dynamic = 'force-dynamic';

/**
 * `/status` — el gap analysis del proyecto, como página viva.
 *
 * Reemplaza al xlsx que pedía el corpus (T001). La razón es que la crítica
 * estándar a una matriz de trazabilidad es que se trate como entregable de una
 * sola vez: un archivo se congela el día que se manda, y este documento tiene
 * que poder corregirse cuando el cliente objete una fila.
 *
 * Datos: docs/gap-analysis-corpus-aug31/{items,juicio}.tsv → scripts/sync_status.py
 * → status_items → GET /api/status → esta página.
 *
 * Reservada a pm, gerencia y superuser (Jorge, 2026-09-03) — ver
 * CAN_VIEW_STATUS. `puedeEditarPlan` se resuelve en el servidor y baja como
 * prop — la interfaz de edición del plan no se dibuja para quien no puede
 * escribirla, y la ruta la vuelve a verificar de todos modos.
 */
export default async function StatusPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_STATUS)) redirect(getDefaultPage(user.role));

  return <StatusClient puedeEditarPlan={isAuthorized(user.role, CAN_EDIT_STATUS_PLAN)} />;
}
