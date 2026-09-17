'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase-client';
import { OrderStatus } from '@/lib/types';

// ============================================================================
// DB-POWERED ORDER STATISTICS
// ----------------------------------------------------------------------------
// The client can only ever hold a slice of the orders table (PostgREST caps a
// row fetch at ~1000, and there are tens of thousands of orders), so counting a
// loaded array gives wrong, device-dependent numbers. These are the REAL counts
// straight from the database via COUNT queries — identical on every device and
// never from a browser cache. Soft-deleted rows (deleted_at) are excluded so
// the numbers match "what we actually have".
// ============================================================================

export const ALL_ORDER_STATUSES: OrderStatus[] = [
  'pending', 'assembling', 'checking', 'packing', 'packed', 'shipped',
  'delivered', 'held', 'no-stock', 'cancelled', 'refunded', 'returned', 'archived',
];

export interface OrderStats {
  total: number;
  byStatus: Record<OrderStatus, number>;
}

/** Live, DB-truth order counts (total + per status). Refreshes on an interval
 *  and whenever the tab becomes visible again. */
export function useOrderStats(refreshMs = 60_000) {
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured()) { setLoading(false); return; }
    try {
      // A HEAD + count query transfers no rows — just the number — so it isn't
      // subject to the row cap and stays cheap even on a huge table.
      const [totalRes, ...statusRes] = await Promise.all([
        supabase.from('orders').select('*', { count: 'exact', head: true }).is('deleted_at', null),
        ...ALL_ORDER_STATUSES.map((st) =>
          supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', st).is('deleted_at', null)
        ),
      ]);
      const byStatus = {} as Record<OrderStatus, number>;
      ALL_ORDER_STATUSES.forEach((st, i) => { byStatus[st] = statusRes[i].count ?? 0; });
      setStats({ total: totalRes.count ?? 0, byStatus });
    } catch (e) {
      console.error('[order-stats] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, refreshMs);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [load, refreshMs]);

  return { stats, loading, refresh: load };
}
