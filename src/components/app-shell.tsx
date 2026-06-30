'use client';

import { useState, useEffect, useRef } from 'react';
import { Sidebar } from './sidebar';
import { EodScheduler } from './eod-scheduler';
import { Menu } from 'lucide-react';
import { Button } from './ui/button';
import { useSupabaseSync } from '@/hooks/use-supabase-sync';
import { CancellationAlert } from './cancellation-alert';
import { TrackingScheduler } from './tracking-scheduler';
import { useOrderStore } from '@/lib/store';
import { SignIn } from './sign-in';

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

  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const currentUser = users.find((u) => u.id === currentUserId);

  // Wait for the persisted store to rehydrate so an already-signed-in user
  // doesn't briefly flash the sign-in screen on reload.
  const [hydrated, setHydrated] = useState(useOrderStore.persist.hasHydrated());
  useEffect(() => {
    const unsub = useOrderStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useOrderStore.persist.hasHydrated());
    return unsub;
  }, []);

  if (!hydrated) {
    return <div className="h-screen w-screen bg-slate-900" />;
  }

  // Not signed in → lock everything down to the sign-in screen (no sidebar, no content).
  if (!currentUser) {
    return <SignIn />;
  }

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
