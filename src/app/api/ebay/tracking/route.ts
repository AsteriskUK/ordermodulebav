import { NextRequest, NextResponse } from 'next/server';
import { getEbayUserToken, EBAY_BASE_URL, EBAY_MARKETPLACE_ID } from '@/lib/ebay-client';

export async function POST(req: NextRequest) {
  const token = await getEbayUserToken();
  if (!token) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  }

  const { orderId, lineItemId, quantity, trackingNumber, shippingCarrierCode, shippedDate } = await req.json();

  if (!orderId || !trackingNumber || !shippingCarrierCode) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
  };

  let lineItems: { lineItemId: string; quantity: number }[] = [];

  if (lineItemId) {
    lineItems = [{ lineItemId, quantity: Math.max(1, Number(quantity) || 1) }];
  } else {
    // Fallback: fetch the eBay order so we can use its line item IDs
    const orderRes = await fetch(`${EBAY_BASE_URL}/sell/fulfillment/v1/order/${orderId}`, { headers });
    if (!orderRes.ok) {
      const message = await orderRes.text();
      return NextResponse.json({ error: 'ebay_order_fetch_failed', status: orderRes.status, message }, { status: 502 });
    }
    const orderData = (await orderRes.json()) as { lineItems?: { lineItemId: string; quantity: number }[] };
    lineItems = (orderData.lineItems || []).map((li) => ({ lineItemId: li.lineItemId, quantity: li.quantity || 1 }));
    if (lineItems.length === 0) {
      return NextResponse.json({ error: 'no_line_items' }, { status: 400 });
    }
  }

  const body = {
    lineItems,
    shippedDate: shippedDate || new Date().toISOString(),
    shippingCarrierCode,
    trackingNumber,
  };

  const res = await fetch(`${EBAY_BASE_URL}/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const message = await res.text();
    return NextResponse.json({ error: 'ebay_api_error', status: res.status, message }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
