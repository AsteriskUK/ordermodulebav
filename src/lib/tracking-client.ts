import { useOrderStore } from './store';

// ============================================================================
// CLIENT-SIDE TRACKING CHECK
// ----------------------------------------------------------------------------
// Runs in the browser (see <TrackingScheduler>), where the order store is
// actually populated. It checks PACKED parcels (→ Shipped on the first courier
// scan) and SHIPPED parcels (→ Delivered on delivery) — packed first. The list
// is capped and sent in small chunks so the request can never time out (the
// unbounded, all-at-once version returned 504 with thousands of shipped orders).
// ============================================================================

const CHUNK = 25;        // ≤ the server's per-request cap
const MAX_PER_RUN = 150; // safety ceiling; the rest are caught on the next run

// Turn a raw status/error into a short, human-friendly line for the UI.
function friendly(status: TrackingRunResult['status'], latestStatus: string, error?: string): string {
  if (error) {
    if (/forbidden|authoriz|\b403\b/i.test(error)) return 'FedEx tracking not authorised yet (account activation pending)';
    if (/timeout/i.test(error)) return 'Timed out — will retry next check';
    if (/could not resolve|not found|\b404\b/i.test(error)) return 'Not in the carrier’s system yet';
    return 'Couldn’t reach the carrier — will retry';
  }
  if (status === 'delivered') return 'Delivered';
  if (status === 'shipped') return 'Scanned by courier — moved to Shipped';
  return latestStatus || 'In transit';
}

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
  const all = useOrderStore.getState().orders
    .filter((o) => (o.status === 'packed' || o.status === 'shipped') && o.trackingNumber && o.deliveryCarrier && !o.deletedAt);
  // Packed first (awaiting the scan → Shipped), then shipped (awaiting delivery).
  const ordered = [...all.filter((o) => o.status === 'packed'), ...all.filter((o) => o.status === 'shipped')];
  const items = ordered.slice(0, MAX_PER_RUN)
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
    if (r.error) { out.push({ ...base, status: 'error', message: friendly('error', '', r.error) }); continue; }
    if (r.delivered) {
      if (order.status !== 'delivered') { store.updateOrderStatus(order.id, 'delivered'); delivered++; }
      out.push({ ...base, status: 'delivered', message: friendly('delivered', r.latestStatus) });
    } else if (order.status === 'packed' && r.hasCourierScan) {
      store.updateOrderStatus(order.id, 'shipped'); moved++;
      out.push({ ...base, status: 'shipped', message: friendly('shipped', r.latestStatus) });
    } else {
      out.push({ ...base, status: 'in_transit', message: friendly('in_transit', r.latestStatus) });
    }
  }
  return { moved, delivered, checked: items.length, results: out };
}
