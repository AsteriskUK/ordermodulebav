'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './sidebar';
import { EodScheduler } from './eod-scheduler';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from './ui/button';
import { useSupabaseSync } from '@/hooks/use-supabase-sync';
import { CancellationAlert } from './cancellation-alert';
import { TrackingScheduler } from './tracking-scheduler';
import { FeedbackMonitor } from './feedback-monitor';
import { useOrderStore } from '@/lib/store';
import { SignIn } from './sign-in';

const SIDEBAR_KEY = 'sidebar-collapsed';

export function AppShell({ children }: { children: React.ReactNode }) {
  // Manual show/hide toggle, persisted across pages/reloads (no auto-hide).
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  });

  const toggleSidebar = () => setSidebarCollapsed((prev) => {
    const next = !prev;
    try { localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      <div className="flex-shrink-0">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
        />
      </div>
      <CancellationAlert />
      <FeedbackMonitor />
      <main className="flex-1 bg-slate-50 overflow-y-auto">
        <div className="p-6">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSidebar}
            className="mb-4"
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
          {children}
        </div>
      </main>
    </div>
  );
}
