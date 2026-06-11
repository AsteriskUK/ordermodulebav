'use client';

import { useState } from 'react';
import { Sidebar } from './sidebar';
import { EodScheduler } from './eod-scheduler';
import { Menu } from 'lucide-react';
import { Button } from './ui/button';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen">
      <EodScheduler />
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <main className={`flex-1 bg-slate-50 overflow-auto transition-all duration-300 ${
        sidebarCollapsed ? 'ml-0' : 'ml-0'
      }`}>
        <div className="p-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="mb-4"
          >
            <Menu className="h-4 w-4" />
          </Button>
          {children}
        </div>
      </main>
    </div>
  );
}
