'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { UserMenu } from './UserMenu';
import OAAlertBanner from './OAAlertBanner';
import { BugReportWidget } from '@/components/feedback/BugReportWidget';

interface AppShellProps {
  children: ReactNode;
}

/**
 * The sidebar collapses into a hamburger button in the top bar (Jorge,
 * 2026-09-04) — it was permanently reserving ~18rem of every screen for
 * navigation, on pages where the actual work is a dense table. It now opens
 * as an overlay on demand (never pushes/reflows the content), closes itself
 * on navigation, on Escape, or on a click outside it. Project-wide: every
 * page, every role, since AppShell is the shared authenticated layout.
 */
export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="flex items-center gap-3 px-6 py-3 bg-white border-b border-gray-200">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Abrir navegación"
            aria-expanded={sidebarOpen}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            <Menu size={20} />
          </button>
          <h1 className="flex-1 text-lg font-semibold text-gray-900">AI Refill</h1>
          <UserMenu />
        </header>
        <OAAlertBanner />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
      <BugReportWidget />
    </div>
  );
}
