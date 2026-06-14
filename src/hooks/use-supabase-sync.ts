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
      
      // Update store with Supabase data
      useOrderStore.setState({
        users: data.users.length > 0 ? data.users : undefined,
        batches: data.batches,
        orders: data.orders,
        attendanceRecords: data.attendanceRecords,
        leaveRequests: data.leaveRequests,
        leaveBalances: data.leaveBalances,
      });
      
      setLastSync(new Date());
      console.log('Synced from Supabase:', data);
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
