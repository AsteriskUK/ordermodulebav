'use client';

import { useEffect } from 'react';
import { useOrderStore } from '@/lib/store';

/**
 * Background tracking scheduler.
 * Automatically checks DPD/FedEx tracking for shipped orders every 4 hours
 * and marks delivered orders as "delivered".
 */
export function TrackingScheduler() {
  const orders = useOrderStore((s) => s.orders);
  const shippedCount = orders.filter((o) => o.status === 'shipped' && o.trackingNumber && o.deliveryCarrier && !o.deletedAt).length;

  useEffect(() => {
    if (shippedCount === 0) return;

    const check = async () => {
      try {
        await fetch('/api/tracking/check-all');
      } catch (e) {
        console.error('[TrackingScheduler] background check failed:', e);
      }
    };

    // Check once on mount (with a small delay to avoid app startup congestion)
    const initialTimeout = setTimeout(check, 30_000);

    // Then every 4 hours
    const interval = setInterval(check, 4 * 60 * 60 * 1000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [shippedCount]);

  return null;
}
