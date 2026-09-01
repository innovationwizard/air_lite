import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_VIEW_INVENTARIOS, getDefaultPage } from '@/lib/auth/roles';
import { ReordenClient } from '../reorden/ReordenClient';

export const dynamic = 'force-dynamic';

/**
 * Modelo Darnel — punto de reorden + lead time + alcance máximo (A4.27).
 *
 * Corto a propósito: el motor es UNO y sirve a los dos modelos, tal como lo
 * declaró quien mandó el libro — *«nos serviría para Darnel y los proveedores
 * de Asia y hasta los locales»*. Lo que cambia son los parámetros
 * (`modelo_proveedor`) y el alcance de códigos (`reorden_inventario.modelo`).
 */
export default async function DarnelVivoPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_INVENTARIOS)) redirect(getDefaultPage(user.role));

  return <ReordenClient modelo="darnel" />;
}
