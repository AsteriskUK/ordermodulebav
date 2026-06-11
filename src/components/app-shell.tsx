'use client';

import { Sidebar } from './sidebar';
import { EodScheduler } from './eod-scheduler';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <EodScheduler />
      <Sidebar />
      <main className="flex-1 bg-slate-50 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
