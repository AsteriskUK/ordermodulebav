'use client';

import { useState, useEffect, useRef } from 'react';
import { Sidebar } from './sidebar';
import { EodScheduler } from './eod-scheduler';
import { Menu } from 'lucide-react';
import { Button } from './ui/button';
import { useSupabaseSync } from '@/hooks/use-supabase-sync';
import { CancellationAlert } from './cancellation-alert';
import { TrackingScheduler } from './tracking-scheduler';

const SIDEBAR_AUTO_HIDE_MS = 3000;

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const autoHideTimer = useRef<NodeJS.Timeout | null>(null);

  const clearAutoHideTimer = () => {
    if (autoHideTimer.current) {
      clearTimeout(autoHideTimer.current);
      autoHideTimer.current = null;
    }
  };

  const startAutoHideTimer = () => {
    clearAutoHideTimer();
    autoHideTimer.current = setTimeout(() => {
      setSidebarCollapsed(true);
    }, SIDEBAR_AUTO_HIDE_MS);
  };

  const handleMouseEnter = () => {
    clearAutoHideTimer();
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
    }
  };

  const handleMouseLeave = () => {
    startAutoHideTimer();
  };

  useEffect(() => {
    return () => clearAutoHideTimer();
  }, []);

  // Initialize Supabase sync (auto-syncs on load and periodically)
  const { isSyncing, isOnline } = useSupabaseSync();

  return (
    <div className="flex h-screen overflow-hidden">
      <EodScheduler />
      <TrackingScheduler />
      <div
        className="flex-shrink-0"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          onNavigate={() => setSidebarCollapsed(true)}
        />
      </div>
      <CancellationAlert />
      <main className="flex-1 bg-slate-50 overflow-y-auto">
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
