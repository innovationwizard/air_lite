'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  AlertTriangle,
  Boxes,
  Warehouse,
  Snowflake,
  ShoppingCart,
  Settings,
  Users,
  Activity,
  Truck,
  // ClipboardList,   // unused while Órdenes Abiertas section is hidden (2026-05-27)
  FileCheck,
  FileUp,
  Gauge,
  // Container,       // unused while Órdenes Abiertas section is hidden (2026-05-27)
  // AlertOctagon,    // unused while Órdenes Abiertas section is hidden (2026-05-27)
  // FileText,        // unused while Órdenes Abiertas section is hidden (2026-05-27)
  // Wrench,          // unused while Órdenes Abiertas section is hidden (2026-05-27)
  ScanEye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserRole } from '@/lib/auth/useUserRole';
import {
  isAuthorized,
  CAN_VIEW_ADMIN,
  CAN_VIEW_SYSTEM,
  // CAN_VIEW_OA,    // unused while Órdenes Abiertas section is hidden (2026-05-27)
  CAN_VIEW_COMPRAS,
  CAN_VIEW_INVENTARIOS,
  CAN_VIEW_OPERACIONES,
  CAN_VIEW_GERENCIA,
  ROLE_LABELS,
  focusRoutes,
  Role,
} from '@/lib/auth/roles';

/** Roles that can see the legacy Riesgos Empresariales grouping — excludes silo roles that now have dedicated sections */
const CAN_VIEW_RISKS: Role[] = ['superuser', 'admin', 'gerencia', 'ventas', 'inventario', 'financiero'];

/** Roles that can see the legacy Prueba de Concepto grouping — compras/operaciones see these items in their own silo sections */
const CAN_VIEW_POC: Role[] = ['superuser', 'admin', 'gerencia', 'ventas', 'inventario', 'financiero', 'testuser'];

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  subtitle: string | null;
  disabled?: boolean;
}

interface NavGroup {
  section: string | null;
  items: NavItem[];
  requiredRoles?: Role[];
}

const allNavGroups: NavGroup[] = [
  {
    section: null,
    items: [
      {
        name: 'Demostración de Valor',
        href: '/backtest',
        icon: BarChart3,
        subtitle: null,
      },
    ],
  },
  {
    section: 'Gerencia',
    requiredRoles: CAN_VIEW_GERENCIA,
    items: [
      {
        name: 'Validación Histórica',
        href: '/gerencia/validacion',
        icon: ScanEye,
        subtitle: 'Cifras cuadran con Odoo',
      },
      {
        name: 'Auditoría de Discrepancias',
        href: '/gerencia/gap-report',
        icon: FileCheck,
        subtitle: 'Puedes verificar cada cifra tú mismo',
      },
      {
        name: 'Forecast',
        href: '/gerencia/forecast',
        icon: BarChart3,
        subtitle: 'Feb + Mar 2026 — 23 SKUs',
      },
    ],
  },
  {
    section: 'Compras',
    requiredRoles: CAN_VIEW_COMPRAS,
    items: [
      {
        name: 'Inicio Compras',
        href: '/compras',
        icon: ShoppingCart,
        subtitle: 'Resumen de Compras',
      },
      {
        name: 'Reabastecimiento',
        href: '/compras/reabastecimiento',
        icon: Warehouse,
        subtitle: 'Sugerido por bodega y proveedor',
      },
      {
        name: 'Reabastecimiento en Vivo',
        href: '/compras/reabastecimiento-vivo',
        icon: Activity,
        subtitle: 'Datos Odoo en vivo + captura en línea',
      },
      {
        name: 'Forecast de Compras',
        href: '/compras/forecast',
        icon: BarChart3,
        subtitle: 'Feb & Mar 2026 — 23 SKUs',
      },
      {
        name: 'Programación de Compras',
        href: '/poc/programacion',
        icon: Truck,
        subtitle: 'Carvajal y Reyma',
        disabled: true,
      },
    ],
  },
  {
    section: 'Inventarios',
    requiredRoles: CAN_VIEW_INVENTARIOS,
    items: [
      {
        name: 'Modelo Reyma',
        href: '/inventarios/reyma',
        icon: Boxes,
        subtitle: 'Réplica del libro — Julio 2026',
      },
      {
        name: 'Modelo Reyma en Vivo',
        href: '/inventarios/reyma-vivo',
        icon: Activity,
        subtitle: 'Datos Odoo en vivo + proyección editable',
      },
      {
        name: 'Cargar Facturas',
        href: '/inventarios/facturas',
        icon: FileUp,
        subtitle: 'Facturas de REYMA + ETA del furgón',
      },
    ],
  },
  {
    section: 'Operaciones',
    requiredRoles: CAN_VIEW_OPERACIONES,
    items: [
      {
        name: 'Inicio Operaciones',
        href: '/operaciones',
        icon: Warehouse,
        subtitle: 'Resumen de Operaciones',
      },
      {
        name: 'Días de Inventario',
        href: '/operaciones/dias-inventario',
        icon: Gauge,
        subtitle: 'Días por SKU y bodega',
      },
      {
        name: 'Hot List',
        href: '/preocupaciones/desabastecimiento',
        icon: AlertTriangle,
        subtitle: 'Por agotarse — asegurar primero',
      },
      {
        name: 'Hold List',
        href: '/preocupaciones/capital-congelado',
        icon: Snowflake,
        subtitle: 'Sobrante — no traer más',
      },
      {
        name: 'Costos de Almacenamiento',
        href: '/preocupaciones/costos-almacenamiento',
        icon: Warehouse,
        subtitle: 'Inventario lento y muerto',
      },
      {
        name: 'Compras Innecesarias',
        href: '/preocupaciones/compras-innecesarias',
        icon: ShoppingCart,
        subtitle: 'Compras que no debían hacerse',
      },
    ],
  },
  {
    section: 'Riesgos Empresariales',
    requiredRoles: CAN_VIEW_RISKS,
    items: [
      {
        name: 'Desabastecimiento',
        href: '/preocupaciones/desabastecimiento',
        icon: AlertTriangle,
        subtitle: 'No quiero perder ventas',
      },
      {
        name: 'Costos de Almacenamiento',
        href: '/preocupaciones/costos-almacenamiento',
        icon: Warehouse,
        subtitle: 'Estoy gastando mucho en bodega',
      },
      {
        name: 'Capital Congelado',
        href: '/preocupaciones/capital-congelado',
        icon: Snowflake,
        subtitle: 'Tengo inventario que no se mueve',
      },
      {
        name: 'Compras Innecesarias',
        href: '/preocupaciones/compras-innecesarias',
        icon: ShoppingCart,
        subtitle: 'Estoy comprando de más',
      },
    ],
  },
  /*
    Órdenes Abiertas section hidden 2026-05-27 — won't be reached in the
    demo and the per-page route_permissions for compras on /api/oa/* haven't
    been audited yet. Restore this object + the CAN_VIEW_OA import + the 5
    lucide-react icon imports (ClipboardList, Container, AlertOctagon,
    FileText, Wrench) after the demo if/when OA pages are demo-ready.

  {
    section: 'Órdenes Abiertas',
    requiredRoles: CAN_VIEW_OA,
    items: [
      {
        name: 'Excepciones del Día',
        href: '/oa/excepciones',
        icon: AlertTriangle,
        subtitle: 'Hot List y Hold List',
      },
      {
        name: 'Dashboard Proveedor',
        href: '/oa/dashboard-proveedor',
        icon: Gauge,
        subtitle: 'Semáforo por producto',
      },
      {
        name: 'Plan Maestro',
        href: '/oa/plan-maestro',
        icon: ClipboardList,
        subtitle: 'OA mensual S1-S4',
      },
      {
        name: 'Cumplimiento',
        href: '/oa/cumplimiento',
        icon: FileCheck,
        subtitle: 'KPIs de facturación',
      },
      {
        name: 'Pedidos Extraordinarios',
        href: '/oa/extraordinarios',
        icon: AlertOctagon,
        subtitle: 'Ampliación de OA',
      },
      {
        name: 'Espacio en Bodega',
        href: '/oa/espacio-bodega',
        icon: Warehouse,
        subtitle: 'Capacidad y saturación m³',
      },
      {
        name: 'Recepción',
        href: '/oa/recepcion',
        icon: Container,
        subtitle: 'Ventanas de descarga',
      },
      {
        name: 'Reporte Proveedor',
        href: '/oa/reporte-proveedor',
        icon: FileText,
        subtitle: 'Compartir con Carvajal/Reyma',
      },
      {
        name: 'Configuración OA',
        href: '/oa/configuracion',
        icon: Wrench,
        subtitle: 'Bodega, rampas, tiempos',
      },
    ],
  },
  */
  {
    section: 'Prueba de Concepto',
    requiredRoles: CAN_VIEW_POC,
    items: [
      {
        name: 'Programación de Compras',
        href: '/poc/programacion',
        icon: Truck,
        subtitle: 'Carvajal y Reyma — 2 semanas máx.',
        disabled: true,
      },
    ],
  },
  {
    section: 'Administración',
    requiredRoles: CAN_VIEW_ADMIN,
    items: [
      {
        name: 'Gestión de Usuarios',
        href: '/admin/usuarios',
        icon: Users,
        subtitle: null,
      },
      {
        name: 'Configuración',
        href: '/admin/configuracion',
        icon: Settings,
        subtitle: null,
      },
    ],
  },
  {
    section: 'Sistema',
    requiredRoles: CAN_VIEW_SYSTEM,
    items: [
      {
        name: 'Panel de Control',
        href: '/superuser',
        icon: Activity,
        subtitle: 'Salud del sistema y ML',
      },
      {
        name: 'Forecast Diagnostic',
        href: '/superuser/forecast-diagnostic',
        icon: BarChart3,
        subtitle: 'Ratio bars + series por UoM + drilldown SKU',
      },
    ],
  },
];

const GERENCIA_DEMO_SECTIONS = new Set<string | null>([null, 'Gerencia']);

export function Sidebar() {
  const pathname = usePathname();
  const { profile } = useUserRole();
  const userRole = profile?.role;
  const isGerenciaDemo = userRole === 'gerencia';

  // Delivery-phase focus: roles in ROLLOUT_FOCUS see only their live pages.
  const focus = focusRoutes(userRole);

  const visibleGroups = allNavGroups
    .filter((group) => {
      if (group.requiredRoles && !isAuthorized(userRole, group.requiredRoles)) return false;
      if (isGerenciaDemo && !GERENCIA_DEMO_SECTIONS.has(group.section)) return false;
      return true;
    })
    .map((group) => (focus
      ? { ...group, items: group.items.filter((item) => focus.includes(item.href)) }
      : group))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="flex flex-col w-72 bg-white border-r border-gray-200">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <Image src="/box.svg" alt="AI Refill" width={32} height={32} />
        <span className="font-semibold text-gray-900 text-sm">AI Refill</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleGroups.map((group, groupIdx) => (
          <div key={groupIdx} className="space-y-1">
            {group.section && (
              <p className="px-3 pt-4 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {group.section}
              </p>
            )}
            {group.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              if (item.disabled) {
                return (
                  <div
                    key={item.href}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-lg text-sm opacity-40 cursor-not-allowed select-none"
                  >
                    <item.icon className="w-5 h-5 mt-0.5 flex-shrink-0 text-gray-400" />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-600">{item.name}</div>
                      {item.subtitle && (
                        <div className="text-xs mt-0.5 text-gray-400">{item.subtitle}</div>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-start gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                    isActive
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                  )}
                >
                  <item.icon className={cn(
                    'w-5 h-5 mt-0.5 flex-shrink-0',
                    isActive ? 'text-emerald-600' : 'text-gray-400',
                  )} />
                  <div className="min-w-0">
                    <div className="font-medium">{item.name}</div>
                    {item.subtitle && (
                      <div className={cn(
                        'text-xs mt-0.5',
                        isActive ? 'text-emerald-500' : 'text-gray-400',
                      )}>
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {profile && (
        <div className="px-5 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500 truncate">{profile.email}</p>
          <p className="text-xs font-medium text-emerald-600">
            {ROLE_LABELS[userRole as Role] ?? userRole}
          </p>
        </div>
      )}
    </aside>
  );
}
