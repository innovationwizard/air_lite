'use client';

import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { UserMenu } from './UserMenu';
import OAAlertBanner from './OAAlertBanner';
import { BugReportWidget } from '@/components/feedback/BugReportWidget';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200">
          <h1 className="text-lg font-semibold text-gray-900">AI Refill</h1>
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
