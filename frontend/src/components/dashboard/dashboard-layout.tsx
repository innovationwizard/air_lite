/**
 * Dashboard Layout Component
 * Provides navigation sidebar and main content area for all dashboards
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/use-auth';
import {
  Users,
  Warehouse,
  DollarSign,
  ShoppingCart,
  ShoppingBag,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  permission: string;
}

const navigation: NavItem[] = [
  {
    href: '/dashboard/compras',
    label: 'Compras',
    icon: <ShoppingBag className="h-5 w-5" />,
    permission: 'recommendation:read',
  },
  {
    href: '/dashboard/ventas',
    label: 'Ventas',
    icon: <ShoppingCart className="h-5 w-5" />,
    permission: 'dashboard:read',
  },
  {
    href: '/dashboard/inventario',
    label: 'Inventario',
    icon: <Warehouse className="h-5 w-5" />,
    permission: 'dashboard:read',
  },
  {
    href: '/dashboard/finanzas',
    label: 'Finanzas',
    icon: <DollarSign className="h-5 w-5" />,
    permission: 'kpi:read',
  },
  {
      href: '/dashboard/gerencia',
      label: 'Gerencia',
    icon: <BarChart3 className="h-5 w-5" />,
    permission: 'dashboard:read',
  },
  {
    href: '/dashboard/admin',
    label: 'Admin',
    icon: <Users className="h-5 w-5" />,
    permission: 'user:read',
  },
  {
    href: '/dashboard/superuser',
    label: 'SUPERUSER',
    icon: <Settings className="h-5 w-5" />,
    permission: 'user:delete', // Only superuser has this
  },
];

export interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();
  const { user, logout, checkAuth } = useAuth();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  // Ensure auth is checked on mount and when navigating
  React.useEffect(() => {
    checkAuth();
  }, [pathname, checkAuth]);

  // Filter navigation based on user permissions
  // Ensure permissions is always treated as an array
  const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const availableNavigation = navigation.filter((item) =>
    userPermissions.includes(item.permission)
  );

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 w-64 bg-card border-r transform transition-transform duration-200 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Image
                  src="/box.svg"
                  alt="AI Refill Logo"
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
                <h1 className="text-2xl font-bold text-primary font-heading">
                  AI Refill
                </h1>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              . 
            </p>
          </div>

          <Separator />

          {/* User Info */}
          {user && (
            <div className="px-6 py-4 bg-muted/50">
              <p className="text-sm font-medium">{user.username}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
              <div className="flex gap-1 mt-2 flex-wrap">
                {user.roles.map((role) => (
                  <span
                    key={role}
                    className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {availableNavigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                  onClick={() => setSidebarOpen(false)}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <Separator />

          {/* Logout Button */}
          <div className="p-4">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={handleLogout}
            >
              <LogOut className="h-5 w-5 mr-3" />
              Sign Out
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header */}
        <header className="lg:hidden bg-card border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Image
                src="/box.svg"
                alt="AI Refill Logo"
                width={24}
                height={24}
                className="w-6 h-6"
              />
              <h2 className="text-lg font-bold text-primary">AI Refill</h2>
            </div>
            <div className="w-10" /> {/* Spacer for centering */}
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

