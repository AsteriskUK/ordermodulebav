import { NextRequest, NextResponse } from 'next/server';
import { Order, Batch } from '@/lib/types';
import { fetchBackmarketOrders, isBackmarketConfigured, mapBackmarketOrderToOrder } from '@/lib/backmarket-api';

export async function GET(req: NextRequest) {
  try {
    if (!isBackmarketConfigured()) {
      return NextResponse.json(
        { error: 'not_configured', message: 'Backmarket credentials not configured. Set BACKMARKET_USERNAME and BACKMARKET_PASSWORD.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const daysBack = parseInt(searchParams.get('days') || '7', 10);
    const state = searchParams.get('state');
    const countryCode = searchParams.get('country_code') || process.env.BACKMARKET_COUNTRY_CODE || 'fr-fr';

    const fromDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const allOrders: Order[] = [];
    let page = 1;
    const pageSize = 50;
    const batchId = `backmarket-${new Date().toISOString().slice(0, 10)}-${Date.now()}`;

    const batch: Batch = {
      id: batchId,
      name: `Backmarket Import ${new Date().toLocaleDateString('en-GB')}`,
      importedAt: new Date().toISOString(),
      orderCount: 0,
      source: 'backmarket',
    };

    while (true) {
      const data = await fetchBackmarketOrders({
        date_creation: fromDate,
        country_code: countryCode,
        state: state ? parseInt(state, 10) : undefined,
        page,
        pageSize,
      });

      const results = data.results || [];
      for (const bmOrder of results) {
        const mapped = mapBackmarketOrderToOrder(bmOrder, batchId);
        allOrders.push(...mapped);
      }

      if (!data.next || results.length === 0 || results.length < pageSize) break;
      page += 1;
    }

    batch.orderCount = allOrders.length;

    return NextResponse.json({ orders: allOrders, batch });
  } catch (err) {
    console.error('[Backmarket orders] Unhandled error:', err);
    return NextResponse.json(
      { error: 'server_error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
