import { NextResponse } from 'next/server';
import { getEbayUserToken } from '@/lib/ebay-client';

const BASE_URL = 'https://api.ebay.com';

export interface EbayCancellationOrder {
  orderId: string;
  orderNumber?: string;
  salesRecordNumber?: string;
  buyerUsername?: string;
  itemTitle?: string;
  cancelStatus?: string;
  cancelReason?: string;
  createdAt?: string;
}

export async function GET() {
  try {
    const accessToken = await getEbayUserToken();
    if (!accessToken) {
      return NextResponse.json({ error: 'not_connected' }, { status: 401 });
    }

    // Filter for orders with a cancellation request (CANCELLATION_REQUESTED filter)
    const filter = 'cancelStatus:{CANCEL_REQUESTED}';
    const url = `${BASE_URL}/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=50`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
      },
    });

    const rawBody = await res.text();
    console.log('[eBay cancellations] status:', res.status, 'body preview:', rawBody.slice(0, 300));

    if (!res.ok) {
      return NextResponse.json({ cancellations: [] });
    }

    let data: { orders?: Record<string, unknown>[] };
    try {
      data = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ cancellations: [] });
    }

    const cancellations: EbayCancellationOrder[] = (data.orders ?? []).map((o) => {
      const lineItem = (o.lineItems as Record<string, unknown>[] | undefined)?.[0];
      const buyer = o.buyer as Record<string, unknown> | undefined;
      const cancelDetail = o.cancelDetail as Record<string, unknown> | undefined;
      return {
        orderId: o.orderId as string,
        orderNumber: o.orderId as string,
        buyerUsername: buyer?.username as string | undefined,
        itemTitle: lineItem?.title as string | undefined,
        cancelStatus: o.cancelStatus as string | undefined,
        cancelReason: cancelDetail?.cancelReason as string | undefined,
        createdAt: o.creationDate as string | undefined,
      };
    });

    return NextResponse.json({ cancellations });
  } catch (err) {
    console.error('[eBay cancellations] Error:', err);
    return NextResponse.json({ cancellations: [] });
  }
}
