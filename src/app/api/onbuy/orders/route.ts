import { NextRequest, NextResponse } from 'next/server';
import { Batch, Order } from '@/lib/types';
import { stableUuid } from '@/lib/utils';
import {
  isOnBuyConfigured,
  getOnBuyCredentials,
  fetchOnBuyOrders,
  mapOnBuyOrderToOrders,
  OnBuyOrder,
} from '@/lib/onbuy-client';

// OnBuy formats timestamps as "YYYY-MM-DD HH:MM:SS".
function onbuyDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export async function GET(req: NextRequest) {
  const creds = getOnBuyCredentials();
  if (!isOnBuyConfigured() || !creds) {
    return NextResponse.json(
      { error: 'not_configured', message: 'OnBuy credentials not configured. Set ONBUY_CONSUMER_KEY and ONBUY_SECRET_KEY (and optionally ONBUY_SITE_ID).' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const daysBack = parseInt(searchParams.get('days') || '7', 10);
    const status = searchParams.get('status') || 'all';
    const modifiedSince = onbuyDate(new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000));

    const batchId = stableUuid(`onbuy-${new Date().toISOString().slice(0, 10)}-${Date.now()}`);
    const limit = 50;
    let offset = 0;
    const allRaw: OnBuyOrder[] = [];

    // Paginate on offset until we've pulled every matching order.
    while (true) {
      const page = await fetchOnBuyOrders({
        siteId: creds.siteId,
        limit,
        offset,
        status,
        modifiedSince,
        sortCreated: 'desc',
      });
      const rows = page.results ?? [];
      allRaw.push(...rows);
      const total = page.metadata?.total_rows ?? allRaw.length;
      offset += limit;
      if (rows.length < limit || allRaw.length >= total) break;
    }

    const orders: Order[] = allRaw.flatMap((o) => mapOnBuyOrderToOrders(o, batchId));

    const batch: Batch = {
      id: batchId,
      name: `OnBuy Import ${new Date().toLocaleDateString('en-GB')}`,
      importedAt: new Date().toISOString(),
      orderCount: orders.length,
      source: 'onbuy',
    };

    return NextResponse.json({ orders, batch });
  } catch (err) {
    console.error('[OnBuy orders] error:', err);
    return NextResponse.json(
      { error: 'server_error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
