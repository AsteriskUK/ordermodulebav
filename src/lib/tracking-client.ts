import { useOrderStore } from './store';

// ============================================================================
// CLIENT-SIDE TRACKING CHECK
// ----------------------------------------------------------------------------
// Runs in the browser (see <TrackingScheduler>), where the order store is
// actually populated. It sends the packed/shipped parcels' tracking numbers to
// the server (which calls the carriers), then applies the status moves through
// the normal store actions so they sync to the DB with the signed-in user:
//   • packed  → shipped   on the first real courier scan
//   • shipped → delivered on delivery
// ============================================================================

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
  const packed = useOrderStore.getState().orders
    .filter((o) => (o.status === 'packed' || o.status === 'shipped') && o.trackingNumber && o.deliveryCarrier && !o.deletedAt);
  const items = packed.map((o) => ({ orderId: o.id, trackingNumber: o.trackingNumber as string, carrier: o.deliveryCarrier as string }));

  if (items.length === 0) return { moved: 0, delivered: 0, checked: 0, results: [] };

  const res = await fetch('/api/tracking/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`tracking check failed ${res.status}`);
  const { results } = await res.json() as { results: CheckResult[] };

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
