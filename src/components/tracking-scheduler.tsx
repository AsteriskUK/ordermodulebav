'use client';

import { useEffect } from 'react';
import { useOrderStore } from '@/lib/store';
import { runTrackingCheck } from '@/lib/tracking-client';

/**
 * Background tracking scheduler.
 * Polls DPD/FedEx tracking for packed + shipped orders and auto-advances them:
 * Packed → Shipped on the first courier scan, Shipped → Delivered on delivery.
 */
export function TrackingScheduler() {
  const orders = useOrderStore((s) => s.orders);
  // Only PACKED parcels are checked (awaiting a courier scan → Shipped); shipped
  // orders are not re-checked (there can be thousands, which timed out).
  const packedCount = orders.filter((o) => o.status === 'packed' && o.trackingNumber && o.deliveryCarrier && !o.deletedAt).length;

  useEffect(() => {
    if (packedCount === 0) return;

    const check = async () => {
      try {
        // Runs in the browser (store is populated here) → server checks the
        // carriers, we apply packed→shipped / →delivered so it syncs to the DB.
        const { moved, delivered } = await runTrackingCheck();
        if (moved || delivered) console.log(`[TrackingScheduler] ${moved} → shipped, ${delivered} → delivered`);
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
  }, [packedCount]);

  return null;
}
