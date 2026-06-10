'use client';

import { Sidebar } from './sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 bg-slate-50 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
