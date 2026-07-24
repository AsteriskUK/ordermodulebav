import { NextResponse } from 'next/server';
import { confirmAmazonShipment, isAmazonConfigured } from '@/lib/amazon-client';

// POST /api/amazon/orders/fulfillment — confirm shipment of an Amazon (MFN) order
// (marks it dispatched for the buyer). The Amazon counterpart of the eBay
// fulfilment upload: called ONLY when the order actually ships from the warehouse,
// with the carrier tracking from the DPD/FedEx label. Fire-and-forget from the
// store; idempotent (skips an order Amazon already shows shipped).
export async function POST(req: Request) {
  if (!isAmazonConfigured()) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const { orderNumber, trackingNumber, carrier } = await req.json() as {
    orderNumber: string;      // Amazon order id (e.g. 202-1234567-1234567)
    trackingNumber: string;
    carrier?: string;         // DPD | FedEx | …
  };
  if (!orderNumber || !trackingNumber) {
    return NextResponse.json({ error: 'orderNumber and trackingNumber are required' }, { status: 400 });
  }

  try {
    const result = await confirmAmazonShipment(orderNumber, { trackingNumber, carrier });
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('[Amazon fulfilment] confirmShipment failed', orderNumber, message);
    return NextResponse.json({ error: 'fulfillment_failed', message }, { status: 502 });
  }
}
