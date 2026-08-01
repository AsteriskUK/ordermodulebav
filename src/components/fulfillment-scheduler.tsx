'use client';

import { useEffect } from 'react';
import { useOrderStore, sweepDueFulfillments } from '@/lib/store';

/**
 * Background marketplace-tracking uploader.
 *
 * Uploads each order's tracking to the marketplace (eBay add-tracking / Amazon
 * confirm-shipment) only once it's within the configured lead time of its eBay
 * ship-by date — so orders processed days early aren't marked despatched too
 * soon. The actual gating lives in the store (sweepDueFulfillments); this just
 * runs it on a timer while the app is open.
 */
export function FulfillmentScheduler() {
  // Re-evaluate when the set of uploadable orders changes.
  const pending = useOrderStore((s) =>
    s.orders.filter((o) => o.trackingNumber && !o.trackingUploadedAt && !o.deletedAt
      && (o.status === 'packed' || o.status === 'shipped')).length
  );

  useEffect(() => {
    if (pending === 0) return;
    // Run shortly after mount, then every 15 minutes (a 12h window doesn't need
    // tighter timing, and each sweep is internally gated + deduped).
    const initial = setTimeout(sweepDueFulfillments, 20_000);
    const interval = setInterval(sweepDueFulfillments, 15 * 60 * 1000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [pending]);

  return null;
}
