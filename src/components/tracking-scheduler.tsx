'use client';

import { useEffect } from 'react';
import { useOrderStore } from '@/lib/store';

/**
 * Background tracking scheduler.
 * Polls DPD/FedEx tracking for packed + shipped orders and auto-advances them:
 * Packed → Shipped on the first courier scan, Shipped → Delivered on delivery.
 */
export function TrackingScheduler() {
  const orders = useOrderStore((s) => s.orders);
  const shippedCount = orders.filter((o) => (o.status === 'packed' || o.status === 'shipped') && o.trackingNumber && o.deliveryCarrier && !o.deletedAt).length;

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

    // Then hourly (responsive enough for scan → Shipped without hammering carriers)
    const interval = setInterval(check, 60 * 60 * 1000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [shippedCount]);

  return null;
}
