'use client';

import { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUserRole } from '@/lib/auth/useUserRole';
import { isAuthorized, CAN_VIEW_OA } from '@/lib/auth/roles';

interface AlertData {
  hot_count: number;
  hold_count: number;
  hold_export_count: number;
  reception_saturated: boolean;
  reception_trucks_today: number;
  warehouse_alerts: { warehouse_id: number; warehouse_name: string; alert_level: string }[];
}

/**
 * Superficies donde este banner NO aparece.
 *
 *   /gerencia  — superficie de demostración: el banner es operativo y estorba
 *                a lo que se está mostrando.
 *   /comercial — la captura del forecast comercial (Jorge, 2026-09-10). El
 *                banner habla de quiebres y exceso de inventario, que son
 *                señales de COMPRAS: el jefe de canal no puede accionarlas, y
 *                sus enlaces lo sacan de la pantalla hacia /oa/excepciones en
 *                medio de una captura contra reloj. El requisito principal de
 *                esa pantalla es QUE SE USE, así que todo lo que no sea
 *                imprescindible se quita del camino.
 *
 * Prefijos, para que las sub-rutas viajen con su página.
 */
const RUTAS_SIN_BANNER = ['/gerencia', '/comercial'];

export default function OAAlertBanner() {
  const pathname = usePathname();
  const { profile, loading: roleLoading } = useUserRole();
  const [alerts, setAlerts] = useState<AlertData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const hasAccess = profile && isAuthorized(profile.role, CAN_VIEW_OA);
  const oculto = RUTAS_SIN_BANNER.some((r) => pathname?.startsWith(r));

  useEffect(() => {
    if (roleLoading || !hasAccess || oculto) return;

    fetch('/api/oa/alerts')
      .then((res) => res.json())
      .then((d) => {
        setAlerts(d);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [roleLoading, hasAccess, oculto]);

  if (oculto) return null;
  if (roleLoading || !hasAccess || !loaded || dismissed) return null;
  if (!alerts) return null;

  const hasHot = alerts.hot_count > 0;
  const hasHold = alerts.hold_count > 0;
  const hasReception = alerts.reception_saturated;
  const hasWarehouse = alerts.warehouse_alerts && alerts.warehouse_alerts.length > 0;

  if (!hasHot && !hasHold && !hasReception && !hasWarehouse) return null;

  const bgColor = hasHot ? 'bg-red-600' : 'bg-amber-500';
  const textColor = hasHot ? 'text-white' : 'text-amber-950';
  const linkColor = hasHot ? 'text-red-100 underline hover:text-white' : 'text-amber-800 underline hover:text-amber-950';

  return (
    <div className={`${bgColor} ${textColor} px-4 py-2 text-sm sticky top-0 z-50`}>
      <div className="max-w-7xl mx-auto flex items-start justify-between gap-4">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {hasHot && (
              <p>
                <Link href="/oa/excepciones" className={linkColor}>
                  {alerts.hot_count} productos en quiebre inminente
                </Link>
              </p>
            )}
            {hasHold && (
              <p>
                <Link href="/oa/excepciones" className={linkColor}>
                  {alerts.hold_count} productos con exceso de inventario
                </Link>
                {alerts.hold_export_count > 0 && (
                  <span className="ml-1">
                    ({alerts.hold_export_count} de exportaci&oacute;n &mdash; no cancelables)
                  </span>
                )}
              </p>
            )}
            {hasReception && (
              <p>
                <Link href="/oa/recepcion" className={linkColor}>
                  Rampa saturada hoy &mdash; {alerts.reception_trucks_today} furgones
                </Link>
              </p>
            )}
            {hasWarehouse && (
              <p>
                <Link href="/oa/espacio-bodega" className={linkColor}>
                  Alerta de espacio en{' '}
                  {alerts.warehouse_alerts.map((w) => w.warehouse_name).join(', ')}
                </Link>
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className={`flex-shrink-0 p-1 rounded hover:bg-black/10 ${textColor}`}
          aria-label="Cerrar alerta"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
