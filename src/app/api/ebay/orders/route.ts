import { NextRequest, NextResponse } from 'next/server';
import { mapEbayOrderToOrder } from '@/lib/ebay-mapper';
import { getEbayUserToken } from '@/lib/ebay-client';
import { Order, Batch } from '@/lib/types';
import { stableUuid } from '@/lib/utils';

const BASE_URL = 'https://api.ebay.com';

export async function GET(req: NextRequest) {
  try {
  const accessToken = await getEbayUserToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'not_connected', message: 'Not connected to eBay. Connect via /api/ebay/auth.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const daysBack = parseInt(searchParams.get('days') || '7');
  const fromDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  // Pull EVERY order in the window, including ones already FULFILLED — orders
  // dispatched on eBay before a pull ran used to be skipped forever, leaving
  // permanent gaps in the order sheet (e.g. records 82093–82228). Fulfilled
  // orders import as 'shipped' (see ebay-mapper) so the queue isn't polluted.
  // A date-only filter returns all fulfillment statuses (eBay error 30800
  // rejects a three-value orderfulfillmentstatus set, and the old code appended
  // creationdate OUTSIDE the filter param, so eBay silently ignored it).
  const filter = searchParams.get('filter') || `creationdate:[${fromDate}..]`;

  const allOrders: Order[] = [];
  let offset = 0;
  const limit = 200;
  const batchId = stableUuid(`ebay-${new Date().toISOString().slice(0, 10)}-${Date.now()}`);

  const batch: Batch = {
    id: batchId,
    name: `eBay Import ${new Date().toLocaleDateString('en-GB')}`,
    importedAt: new Date().toISOString(),
    orderCount: 0,
    source: 'ebay',
  };

  while (true) {
    const url = `${BASE_URL}/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=${limit}&offset=${offset}`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
      },
    });

    const rawBody = await res.text();
    console.log('[eBay orders] status:', res.status, 'body preview:', rawBody.slice(0, 300));

    if (!res.ok) {
      console.error('[eBay orders] API error:', res.status, rawBody);
      return NextResponse.json({ error: 'ebay_api_error', message: rawBody }, { status: res.status });
    }

    let data: { orders?: unknown[]; total?: number };
    try {
      data = JSON.parse(rawBody);
    } catch {
      console.error('[eBay orders] Failed to parse JSON:', rawBody.slice(0, 500));
      return NextResponse.json({ error: 'invalid_json', message: rawBody.slice(0, 500) }, { status: 502 });
    }
    const pageOrders = data.orders || [];

    for (const ebayOrder of pageOrders) {
      const mapped = mapEbayOrderToOrder(ebayOrder as Parameters<typeof mapEbayOrderToOrder>[0], batchId);
      allOrders.push(...mapped);
    }

    if (pageOrders.length < limit) break;
    offset += limit;
  }

  batch.orderCount = allOrders.length;

  return NextResponse.json({ orders: allOrders, batch });
  } catch (err) {
    console.error('[eBay orders] Unhandled error:', err);
    return NextResponse.json({ error: 'server_error', message: String(err) }, { status: 500 });
  }
}
