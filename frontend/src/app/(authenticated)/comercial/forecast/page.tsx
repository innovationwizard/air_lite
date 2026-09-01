import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_VIEW_FORECAST_COMERCIAL, getDefaultPage } from '@/lib/auth/roles';
import { ForecastClient } from './ForecastClient';

export const dynamic = 'force-dynamic';

/**
 * Forecast comercial — nivel 1.
 *
 * Reemplaza la hoja en la nube que cada canal llena por separado y que alguien
 * después descarga una por una y une a mano. La medición del proceso actual es
 * el requisito de diseño: la llenaron CUATRO de seis áreas, y una de las que no
 * la llenó fue porque no entendió el archivo. Por eso el nivel 1 son cuatro
 * campos y ni uno más.
 *
 * El ciclo lo fija el cliente y no este proyecto: la captura cierra el 2º
 * viernes y la reunión es el 3er miércoles.
 */
export default async function ForecastComercialPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_FORECAST_COMERCIAL)) redirect(getDefaultPage(user.role));

  return <ForecastClient />;
}
