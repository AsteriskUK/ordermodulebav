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
      
      // Merge strategy: keep local data, add missing items from Supabase
      // For orders/batches - local is source of truth (CSV imports happen locally)
      // For HR data - Supabase is source of truth (attendance/leave from other devices)
      
      const existingOrderIds = new Set(currentState.orders.map(o => o.id));
      const existingBatchIds = new Set(currentState.batches.map(b => b.id));
      const existingReturnIds = new Set(currentState.returns.map(r => r.id));
      
      // Add any orders/batches/returns from Supabase that don't exist locally
      const newOrders = data.orders.filter(o => !existingOrderIds.has(o.id));
      const newBatches = data.batches.filter(b => !existingBatchIds.has(b.id));
      const newReturns = data.returns.filter(r => !existingReturnIds.has(r.id));
      
      useOrderStore.setState({
        // Users: Supabase has more users, use it if available
        users: data.users.length > 0 ? data.users : currentState.users,
        // Batches: merge local + any from Supabase
        batches: [...currentState.batches, ...newBatches],
        // Orders: merge local + any from Supabase
        orders: [...currentState.orders, ...newOrders],
        // Returns: merge local + any from Supabase
        returns: [...currentState.returns, ...newReturns],
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
      });
      
      setLastSync(new Date());
      console.log('Synced from Supabase:', { newOrders: newOrders.length, newBatches: newBatches.length, newReturns: newReturns.length });
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
