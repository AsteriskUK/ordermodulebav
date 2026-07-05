import { NextRequest, NextResponse } from 'next/server';
import { Batch, Order } from '@/lib/types';
import { stableUuid } from '@/lib/utils';
import {
  isAmazonConfigured,
  createOrdersRdt,
  getAmazonAccessToken,
  fetchAmazonOrders,
  fetchAmazonOrderItems,
  mapAmazonOrderToOrders,
  AmazonOrder,
  AmazonOrderItem,
} from '@/lib/amazon-client';

// Bound a single sync so it can't run away on a large window or hit rate limits.
const MAX_ORDERS = 200;
const TIME_BUDGET_MS = 25_000;

export async function GET(req: NextRequest) {
  if (!isAmazonConfigured()) {
    return NextResponse.json(
      { error: 'not_configured', message: 'Amazon SP-API credentials not configured. Set AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET and AMAZON_REFRESH_TOKEN.' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const daysBack = parseInt(searchParams.get('days') || '7', 10);
    // SP-API rejects CreatedAfter within the last 2 minutes; back off slightly.
    const createdAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const batchId = stableUuid(`amazon-${new Date().toISOString().slice(0, 10)}-${Date.now()}`);
    const startedAt = Date.now();

    // Prefer one RDT for the whole sync so getOrders returns buyer + address
    // inline. If the Tokens API is unavailable (sandbox) or the app lacks the PII
    // role, fall back to a plain access token — orders still import, but buyer
    // name / shipping address come back blank.
    let ordersToken: string;
    try {
      ordersToken = await createOrdersRdt();
    } catch (e) {
      console.warn('[Amazon orders] RDT unavailable, using plain token (buyer/address may be blank):', e);
      ordersToken = await getAmazonAccessToken();
    }

    const rawOrders: AmazonOrder[] = [];
    let nextToken: string | undefined;
    do {
      const page = await fetchAmazonOrders({ createdAfter, nextToken, token: ordersToken });
      rawOrders.push(...(page.Orders ?? []));
      nextToken = page.NextToken;
    } while (nextToken && rawOrders.length < MAX_ORDERS && Date.now() - startedAt < TIME_BUDGET_MS);

    // Fetch item lines per order (sequential — the orderItems endpoint is rate
    // limited). Degrade to an order-total line if an item fetch fails.
    const orders: Order[] = [];
    for (const o of rawOrders) {
      if (Date.now() - startedAt >= TIME_BUDGET_MS) break;
      let items: AmazonOrderItem[];
      try {
        items = await fetchAmazonOrderItems(o.AmazonOrderId);
      } catch (e) {
        console.warn('[Amazon orders] item fetch failed for', o.AmazonOrderId, e);
        items = [];
      }
      orders.push(...mapAmazonOrderToOrders(o, items, batchId));
    }

    const batch: Batch = {
      id: batchId,
      name: `Amazon Import ${new Date().toLocaleDateString('en-GB')}`,
      importedAt: new Date().toISOString(),
      orderCount: orders.length,
      source: 'amazon',
    };

    return NextResponse.json({ orders, batch });
  } catch (err) {
    console.error('[Amazon orders] error:', err);
    return NextResponse.json(
      { error: 'server_error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
