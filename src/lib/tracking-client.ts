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

// The stored delivery_carrier is unreliable (import artifacts — e.g. orders
// marked FedEx that were actually shipped by DPD), so tracking by it hits the
// wrong API. Resolve the REAL carrier for tracking from, in order:
//   1. labelCarrier — the carrier the label was actually booked with, or
//   2. the tracking-number format — DPD = 10/14 digits, FedEx = 12/15 digits, or
//   3. delivery_carrier as a last resort.
export function resolveTrackingCarrier(o: { trackingNumber?: string; labelCarrier?: string; deliveryCarrier?: string }): 'DPD' | 'FedEx' | null {
  const lc = o.labelCarrier;
  if (lc === 'DPD' || lc === 'FedEx') return lc;
  const digits = String(o.trackingNumber || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 14) return 'DPD';
  if (digits.length === 12 || digits.length === 15) return 'FedEx';
  if (o.deliveryCarrier === 'DPD' || o.deliveryCarrier === 'FedEx') return o.deliveryCarrier;
  return null; // unknown/untrackable (e.g. Parcelforce, or no numeric tracking)
}

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
  // Attach the RESOLVED tracking carrier and drop anything untrackable.
  const trackable = useOrderStore.getState().orders
    .filter((o) => (o.status === 'packed' || o.status === 'shipped') && o.trackingNumber && !o.deletedAt)
    .map((o) => ({ order: o, carrier: resolveTrackingCarrier(o) }))
    .filter((x): x is { order: typeof x.order; carrier: 'DPD' | 'FedEx' } => x.carrier !== null);

  // Packed first (awaiting the scan → Shipped), then shipped (awaiting delivery).
  const ordered = [
    ...trackable.filter((x) => x.order.status === 'packed'),
    ...trackable.filter((x) => x.order.status === 'shipped'),
  ];
  const items = ordered.slice(0, MAX_PER_RUN)
    .map((x) => ({ orderId: x.order.id, trackingNumber: x.order.trackingNumber as string, carrier: x.carrier }));

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
    const base = { orderId: order.id, trackingNumber: order.trackingNumber as string, carrier: (resolveTrackingCarrier(order) || order.deliveryCarrier || '') as string };
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
