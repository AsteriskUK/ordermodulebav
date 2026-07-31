'use client';

import { useEffect, useCallback, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { isSupabaseConfigured } from '@/lib/supabase-client';
import { loadAllFromSupabase, syncAttendance as syncAttendanceToSupabase, syncLeaveRequest as syncLeaveToSupabase } from '@/lib/supabase-store';
import { toast } from 'sonner';

export function useSupabaseSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  // Get store setters
  const setUsers = useCallback((users: any[]) => {
    useOrderStore.setState({ users });
  }, []);
  
  // Sync from Supabase to local store
  const syncFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      console.log('Supabase not configured, skipping sync');
      return;
    }
    
    setIsSyncing(true);
    try {
      const data = await loadAllFromSupabase();
      const currentState = useOrderStore.getState();

      // Merge strategy: the DB is the source of truth (so changes made on another
      // device — booked labels, status moves, soft-deletes — always propagate),
      // but any record that exists only locally (a just-imported order not yet
      // synced to the DB) is preserved so it's never lost. On a failed/empty fetch
      // every record counts as local-only, so nothing is wiped.
      const dbOrderIds = new Set(data.orders.map(o => o.id));
      const dbBatchIds = new Set(data.batches.map(b => b.id));
      const dbReturnIds = new Set(data.returns.map(r => r.id));
      const dbMissingIds = new Set(data.missingItems.map(m => m.id));
      const localOnlyOrders = currentState.orders.filter(o => !dbOrderIds.has(o.id));
      const localOnlyBatches = currentState.batches.filter(b => !dbBatchIds.has(b.id));
      const localOnlyReturns = currentState.returns.filter(r => !dbReturnIds.has(r.id));
      const localOnlyMissing = currentState.missingItems.filter(m => !dbMissingIds.has(m.id));

      useOrderStore.setState({
        // Users: Supabase has more users, use it if available
        users: data.users.length > 0 ? data.users : currentState.users,
        // DB wins for synced records; keep local-only (unsynced) ones.
        batches: [...data.batches, ...localOnlyBatches],
        orders: [...data.orders, ...localOnlyOrders],
        returns: [...data.returns, ...localOnlyReturns],
        // HR data: Supabase is source of truth for multi-device sync
        attendanceRecords: data.attendanceRecords.length > 0 
          ? data.attendanceRecords 
          : currentState.attendanceRecords,
        leaveRequests: data.leaveRequests.length > 0 
          ? data.leaveRequests 
          : currentState.leaveRequests,
        leaveBalances: data.leaveBalances.length > 0
          ? data.leaveBalances
          : currentState.leaveBalances,
        // Tickets: Supabase is source of truth for multi-device sync
        tickets: data.tickets.length > 0 ? data.tickets : currentState.tickets,
        // Missing items: DB wins; keep local-only ones.
        missingItems: [...data.missingItems, ...localOnlyMissing],
        // Inventory: Supabase is source of truth for multi-device sync
        inventoryParts: data.inventoryParts.length > 0 ? data.inventoryParts : currentState.inventoryParts,
        stockUnits: data.stockUnits.length > 0 ? data.stockUnits : currentState.stockUnits,
        stockLevels: data.stockLevels.length > 0 ? data.stockLevels : currentState.stockLevels,
        goodsReceipts: data.goodsReceipts.length > 0 ? data.goodsReceipts : currentState.goodsReceipts,
        builds: data.builds.length > 0 ? data.builds : currentState.builds,
        // Access control: Supabase is source of truth (null until an admin saves one).
        accessControl: data.accessControl ?? currentState.accessControl,
        // App settings: Supabase is source of truth (null = all registry defaults).
        appSettings: data.appSettings ?? currentState.appSettings,
        // EOD events: DB wins; keep any local-only (unsynced) events by their
        // orderId+changedAt+toStatus identity so nothing recorded offline is lost.
        eodEvents: (() => {
          const dbKeys = new Set(data.eodEvents.map((e) => `${e.orderId}|${e.changedAt}|${e.toStatus}`));
          const localOnly = currentState.eodEvents.filter((e) => !dbKeys.has(`${e.orderId}|${e.changedAt}|${e.toStatus}`));
          return [...data.eodEvents, ...localOnly];
        })(),
      });

      setLastSync(new Date());
      console.log('Synced from Supabase:', { orders: data.orders.length, localOnlyOrders: localOnlyOrders.length, batches: data.batches.length, returns: data.returns.length, tickets: data.tickets.length });
    } catch (err) {
      console.error('Error syncing from Supabase:', err);
      toast.error('Failed to sync from cloud');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Watch for online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Back online - syncing...');
      syncFromSupabase();
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('Offline mode - changes will sync when reconnected');
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncFromSupabase]);

  // Initial sync on mount
  useEffect(() => {
    syncFromSupabase();
  }, [syncFromSupabase]);

  // Periodic sync every 5 minutes
  useEffect(() => {
    const interval = setInterval(syncFromSupabase, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [syncFromSupabase]);

  return {
    isSyncing,
    lastSync,
    isOnline,
    syncNow: syncFromSupabase,
  };
}

// Hook to sync attendance changes to Supabase
export function useAttendanceSync() {
  const syncAttendance = useCallback(async (record: any) => {
    if (!isSupabaseConfigured()) return;
    
    try {
      await syncAttendanceToSupabase(record);
    } catch (err) {
      console.error('Error syncing attendance:', err);
    }
  }, []);

  return { syncAttendance };
}

// Hook to sync leave changes to Supabase
export function useLeaveSync() {
  const syncLeave = useCallback(async (request: any) => {
    if (!isSupabaseConfigured()) return;
    
    try {
      await syncLeaveToSupabase(request);
    } catch (err) {
      console.error('Error syncing leave:', err);
    }
  }, []);

  return { syncLeave };
}
