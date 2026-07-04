import { NextRequest, NextResponse } from 'next/server';
import { Batch, Order } from '@/lib/types';
import { stableUuid } from '@/lib/utils';
import {
  isTemuConfigured,
  fetchTemuOrders,
  fetchTemuShippingInfoBatch,
  mapTemuPageItemToOrders,
  TemuPageItem,
} from '@/lib/temu-client';

export async function GET(req: NextRequest) {
  if (!isTemuConfigured()) {
    return NextResponse.json(
      { error: 'not_configured', message: 'Temu credentials not configured. Set TEMU_APP_KEY, TEMU_APP_SECRET, and TEMU_ACCESS_TOKEN.' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const daysBack = parseInt(searchParams.get('days') || '7', 10);
    const status = searchParams.get('status') ? parseInt(searchParams.get('status')!, 10) : undefined;

    const createAfter = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000);
    const createBefore = Math.floor(Date.now() / 1000);

    const batchId = stableUuid(`temu-${new Date().toISOString().slice(0, 10)}-${Date.now()}`);
    const allItems: TemuPageItem[] = [];
    let pageNumber = 1;
    const pageSize = 100;

    // Paginate order list
    while (true) {
      const result = await fetchTemuOrders({
        pageNumber,
        pageSize,
        createAfter,
        createBefore,
        parentOrderStatus: status,
        sortby: 'createTime',
      });

      const items = result.pageItems ?? [];
      allItems.push(...items);

      if (items.length < pageSize || allItems.length >= (result.totalItemNum ?? 0)) break;
      pageNumber++;
    }

    // Fetch shipping info for all orders in parallel (5 at a time)
    const orderSns = allItems.map((item) => item.parentOrderMap.parentOrderSn);
    const shippingMap = await fetchTemuShippingInfoBatch(orderSns, 5);

    // Map to internal Order format
    const allOrders: Order[] = [];
    for (const item of allItems) {
      const shipping = shippingMap.get(item.parentOrderMap.parentOrderSn);
      allOrders.push(...mapTemuPageItemToOrders(item, batchId, shipping));
    }

    const batch: Batch = {
      id: batchId,
      name: `Temu Import ${new Date().toLocaleDateString('en-GB')}`,
      importedAt: new Date().toISOString(),
      orderCount: allOrders.length,
      source: 'temu',
    };

    return NextResponse.json({ orders: allOrders, batch });
  } catch (err) {
    console.error('[Temu orders] error:', err);
    return NextResponse.json(
      { error: 'server_error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
