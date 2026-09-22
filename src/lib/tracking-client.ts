import { useOrderStore } from './store';

// ============================================================================
// CLIENT-SIDE TRACKING CHECK
// ----------------------------------------------------------------------------
// Runs in the browser (see <TrackingScheduler>), where the order store is
// actually populated. It checks ONLY PACKED parcels — the ones waiting on a
// courier scan to advance — and moves each to Shipped on the first real scan
// (or straight to Delivered if it's already been delivered). Shipped orders are
// deliberately NOT re-checked: there can be thousands of them and doing so timed
// the request out. Chunked + capped so the request can never time out.
// ============================================================================

const CHUNK = 25;       // ≤ the server's per-request cap
const MAX_PER_RUN = 75; // safety ceiling; the rest are caught on the next run

interface CheckResult {
  orderId: string;
  delivered: boolean;
  hasCourierScan: boolean;
  latestStatus: string;
  error?: string;
}

export interface TrackingRunResult {
  orderId: string;
  trackingNumber: string;
  carrier: string;
  status: 'delivered' | 'shipped' | 'in_transit' | 'error';
  message?: string;
}

export async function runTrackingCheck(): Promise<{ moved: number; delivered: number; checked: number; results: TrackingRunResult[] }> {
  const items = useOrderStore.getState().orders
    .filter((o) => o.status === 'packed' && o.trackingNumber && o.deliveryCarrier && !o.deletedAt)
    .slice(0, MAX_PER_RUN)
    .map((o) => ({ orderId: o.id, trackingNumber: o.trackingNumber as string, carrier: o.deliveryCarrier as string }));

  if (items.length === 0) return { moved: 0, delivered: 0, checked: 0, results: [] };

  // Send in small chunks so a request can never exceed the serverless timeout.
  const results: CheckResult[] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    const res = await fetch('/api/tracking/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.slice(i, i + CHUNK) }),
    });
    if (!res.ok) throw new Error(`tracking check failed ${res.status}`);
    const data = await res.json() as { results: CheckResult[] };
    results.push(...data.results);
  }

  let moved = 0, delivered = 0;
  const store = useOrderStore.getState();
  const out: TrackingRunResult[] = [];
  for (const r of results) {
    const order = store.orders.find((o) => o.id === r.orderId);
    if (!order) continue;
    const base = { orderId: order.id, trackingNumber: order.trackingNumber as string, carrier: order.deliveryCarrier as string };
    if (r.error) { out.push({ ...base, status: 'error', message: r.error }); continue; }
    if (r.delivered) {
      if (order.status !== 'delivered') { store.updateOrderStatus(order.id, 'delivered'); delivered++; }
      out.push({ ...base, status: 'delivered', message: 'Delivered' });
    } else if (order.status === 'packed' && r.hasCourierScan) {
      store.updateOrderStatus(order.id, 'shipped'); moved++;
      out.push({ ...base, status: 'shipped', message: `Scanned by ${order.deliveryCarrier} — moved to Shipped` });
    } else {
      out.push({ ...base, status: 'in_transit', message: r.latestStatus || 'In transit' });
    }
  }
  return { moved, delivered, checked: items.length, results: out };
}
