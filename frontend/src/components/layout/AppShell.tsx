'use client';

import { ReactNode } from 'react';
import { FearsSidebar } from './FearsSidebar';
import { UserMenu } from './UserMenu';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen bg-gray-50">
      <FearsSidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-gray-900">AI Refill Lite</h1>
            <span className="px-2 py-0.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full">
              Beta
            </span>
          </div>
          <UserMenu />
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
