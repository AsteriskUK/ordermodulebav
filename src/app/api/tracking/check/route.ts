import { NextResponse } from 'next/server';
import { carrierTrackingStatus } from '@/lib/tracking-carrier';

// POST /api/tracking/check  { items: [{ orderId, trackingNumber, carrier }] }
// Server-side carrier tracking: calls FedEx/DPD (which need credentials) for
// each parcel and returns the status flags. The client applies the resulting
// status moves (packed→shipped on first courier scan, →delivered on delivery)
// so they persist through the normal store→DB sync.
//
// Bounded so it can't time out: at most MAX_ITEMS per request (the client sends
// small chunks), a per-parcel timeout, and real concurrency instead of serial
// batches with sleeps — a single slow/hanging carrier call can't stall the run.

const MAX_ITEMS = 30;
const CONCURRENCY = 8;
const PER_PARCEL_TIMEOUT_MS = 9000;

type Item = { orderId: string; trackingNumber: string; carrier: string };
type Result = { orderId: string } & Awaited<ReturnType<typeof carrierTrackingStatus>>;

async function withTimeout(carrier: string, trackingNumber: string): Promise<Awaited<ReturnType<typeof carrierTrackingStatus>>> {
  return Promise.race([
    carrierTrackingStatus(carrier, trackingNumber),
    new Promise<Awaited<ReturnType<typeof carrierTrackingStatus>>>((resolve) =>
      setTimeout(() => resolve({ delivered: false, hasCourierScan: false, latestStatus: '', error: 'timeout' }), PER_PARCEL_TIMEOUT_MS),
    ),
  ]);
}

export async function POST(req: Request) {
  const { items } = await req.json().catch(() => ({})) as { items?: Item[] };
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const queue = items.slice(0, MAX_ITEMS);
  const results: Result[] = [];
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      const it = queue[next++];
      results.push({ orderId: it.orderId, ...(await withTimeout(it.carrier, it.trackingNumber)) });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  return NextResponse.json({ results, truncated: items.length > MAX_ITEMS });
}
