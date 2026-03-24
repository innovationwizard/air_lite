'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  AlertTriangle,
  Warehouse,
  Snowflake,
  ShoppingCart,
  Settings,
  Users,
  Activity,
  Truck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserRole } from '@/lib/auth/useUserRole';
import { isAuthorized, CAN_VIEW_ADMIN, CAN_VIEW_SYSTEM, ROLE_LABELS, Role } from '@/lib/auth/roles';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  subtitle: string | null;
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
    section: 'Mis Preocupaciones',
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
  {
    section: 'POC Cliente',
    items: [
      {
        name: 'Programación de Compras',
        href: '/poc/programacion',
        icon: Truck,
        subtitle: 'Carvajal y Reyma — 2 semanas máx.',
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
    ],
  },
];

export function FearsSidebar() {
  const pathname = usePathname();
  const { profile } = useUserRole();
  const userRole = profile?.role;

  const visibleGroups = allNavGroups.filter(
    (group) => !group.requiredRoles || isAuthorized(userRole, group.requiredRoles),
  );

  return (
    <aside className="flex flex-col w-72 bg-white border-r border-gray-200">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <Image src="/box.svg" alt="AI Refill Lite" width={32} height={32} />
        <div>
          <span className="font-semibold text-gray-900 text-sm">AI Refill</span>
          <span className="text-gray-400 text-xs ml-1">Lite</span>
        </div>
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
