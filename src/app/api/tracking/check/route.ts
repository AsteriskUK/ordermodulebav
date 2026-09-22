import { NextResponse } from 'next/server';
import { carrierTrackingStatus } from '@/lib/tracking-carrier';

// POST /api/tracking/check  { items: [{ orderId, trackingNumber, carrier }] }
// Server-side carrier tracking: calls FedEx/DPD (which need credentials) for
// each parcel and returns the status flags. The client applies the resulting
// status moves (packed→shipped on first courier scan, →delivered on delivery)
// so they persist through the normal store→DB sync.
export async function POST(req: Request) {
  const { items } = await req.json().catch(() => ({})) as {
    items?: { orderId: string; trackingNumber: string; carrier: string }[];
  };
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ results: [] });
  }

  // Check in small batches with a short gap to avoid carrier rate limits.
  const batchSize = 5;
  const results: Array<{ orderId: string } & Awaited<ReturnType<typeof carrierTrackingStatus>>> = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (it) => ({ orderId: it.orderId, ...(await carrierTrackingStatus(it.carrier, it.trackingNumber)) })),
    );
    results.push(...batchResults);
    if (i + batchSize < items.length) await new Promise((r) => setTimeout(r, 800));
  }

  return NextResponse.json({ results });
}
