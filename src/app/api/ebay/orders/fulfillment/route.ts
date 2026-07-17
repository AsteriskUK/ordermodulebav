import { NextRequest, NextResponse } from 'next/server';
import { getEbayUserToken } from '@/lib/ebay-client';

const BASE_URL = 'https://api.ebay.com';

// POST /api/ebay/orders/fulfillment — upload tracking to eBay (marks the order
// dispatched for the buyer). Called ONLY when the order actually ships from the
// warehouse — until then the tracking number is shared with the buyer as an
// order message, not as a fulfilment (per workflow: book early, fulfil on ship).
export async function POST(req: NextRequest) {
  const token = await getEbayUserToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const { orderNumber, trackingNumber, carrier } = await req.json() as {
    orderNumber: string;      // eBay order id (e.g. 12-34567-89012)
    trackingNumber: string;
    carrier?: string;         // DPD | FedEx | …
  };
  if (!orderNumber || !trackingNumber) {
    return NextResponse.json({ error: 'orderNumber and trackingNumber are required' }, { status: 400 });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
  };

  // The fulfilment payload needs the order's line items — fetch them first.
  const orderRes = await fetch(`${BASE_URL}/sell/fulfillment/v1/order/${orderNumber}`, { headers });
  if (!orderRes.ok) {
    const msg = await orderRes.text();
    console.error('[eBay fulfilment] order lookup failed', orderRes.status, msg.slice(0, 300));
    return NextResponse.json({ error: 'order_lookup_failed', message: msg.slice(0, 300) }, { status: orderRes.status });
  }
  const order = await orderRes.json() as {
    lineItems?: { lineItemId: string; quantity: number }[];
    fulfillmentHrefs?: string[];
  };

  // Already fulfilled → done (keeps repeated "shipped" transitions idempotent).
  if (order.fulfillmentHrefs && order.fulfillmentHrefs.length > 0) {
    return NextResponse.json({ success: true, alreadyFulfilled: true });
  }

  const res = await fetch(`${BASE_URL}/sell/fulfillment/v1/order/${orderNumber}/shipping_fulfillment`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      lineItems: (order.lineItems ?? []).map((li) => ({ lineItemId: li.lineItemId, quantity: li.quantity })),
      shippedDate: new Date().toISOString(),
      shippingCarrierCode: carrier || 'DPD',
      trackingNumber,
    }),
  });
  if (!res.ok) {
    const msg = await res.text();
    console.error('[eBay fulfilment] create failed', res.status, msg.slice(0, 300));
    return NextResponse.json({ error: 'fulfillment_failed', message: msg.slice(0, 300) }, { status: res.status });
  }
  return NextResponse.json({ success: true, location: res.headers.get('Location') });
}
