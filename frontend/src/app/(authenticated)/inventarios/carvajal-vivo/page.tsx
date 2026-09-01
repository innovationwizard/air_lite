import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/auth/server';
import { isAuthorized, CAN_VIEW_INVENTARIOS, getDefaultPage } from '@/lib/auth/roles';
import { VivoClient } from '../reyma-vivo/VivoClient';

export const dynamic = 'force-dynamic';

/**
 * Modelo CARVAJAL en vivo — A4.26.
 *
 * Este archivo es corto a propósito, y esa brevedad ES la implementación.
 *
 * *«Ese mismo modelo hay que replicarlo en Carvajal, vos. ES EL MISMO. Solo que
 * ya no van a ser 6 furgones a la semana. En Carvajal son más… entre 15 y 20.
 * Semanales.»* (2026-08-13)
 *
 * Se tomó al pie de la letra: se importa el MISMO `VivoClient` que sirve a
 * Reyma y se le pasa otro modelo. No hay un segundo motor, ni una copia del
 * MRP, ni una segunda implementación del pedido óptimo. Lo que cambia son dos
 * cosas y las dos son datos: el alcance de códigos (`reyma_products.modelo`) y
 * los parámetros (`modelo_proveedor`).
 *
 * POR QUÉ IMPORTA QUE SEA ASÍ. Lo más caro de este proyecto es la paridad de
 * 2,752 de 2,752 celdas contra el libro de Alexis. Un motor duplicado la
 * pierde el día que alguien corrija una fórmula en un archivo y no en el otro,
 * y nadie se entera hasta que dos pantallas dan dos pedidos distintos para el
 * mismo producto.
 *
 * ⚠️ ALCANCE PROVISIONAL. Los códigos de Carvajal se derivaron de los cuatro
 * proveedores Carvajal de Odoo, no de una lista que Alexis haya entregado —
 * como sí entregó las 55 de Reyma. La página lo declara en pantalla. Varios
 * parámetros (lead time, días de despacho, stock de seguridad) siguen sin
 * declararse por nadie y viajan en null, mostrándose como «sin definir» en vez
 * de heredar los de Reyma en silencio.
 */
export default async function CarvajalVivoPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!isAuthorized(user.role, CAN_VIEW_INVENTARIOS)) redirect(getDefaultPage(user.role));

  return <VivoClient modelo="carvajal" />;
}
