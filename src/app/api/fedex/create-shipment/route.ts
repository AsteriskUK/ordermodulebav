import { NextRequest, NextResponse } from 'next/server';
import { createFedExShipment } from '@/lib/fedex-client';
import { buildFedExShipmentPayload } from '@/lib/fedex-payload';
import { Order } from '@/lib/types';

function notConfigured() {
  return !process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET || !process.env.FEDEX_ACCOUNT_NUMBER;
}

export async function POST(req: NextRequest) {
  if (notConfigured()) {
    return NextResponse.json(
      { error: 'not_configured', message: 'FedEx API credentials not set. Fill in FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET, FEDEX_ACCOUNT_NUMBER in .env.local.' },
      { status: 503 }
    );
  }

  const body = await req.json() as { orders: Order[]; shipDate?: string };
  const { orders, shipDate = new Date().toISOString().slice(0, 10) } = body;

  if (!orders?.length) {
    return NextResponse.json({ error: 'No orders provided' }, { status: 400 });
  }

  type ShipResult = { ok: true; orderId: string; salesRecordNumber: string; trackingNumber?: string; labelBase64?: string; allLabels?: string[]; labelPdfs?: string[] } | { ok: false; orderId: string; salesRecordNumber: string; error: string };

  const results: ShipResult[] = await Promise.all(
    orders.map(async (order): Promise<ShipResult> => {
      try {
        const payload = buildFedExShipmentPayload(order, shipDate);
        const res = await createFedExShipment(payload);
        const shipment = res.output?.transactionShipments?.[0];
        const trackingNumber = shipment?.masterTrackingNumber;
        const allLabels = shipment?.pieceResponses
          ?.map((p: { packageDocuments?: { encodedLabel?: string }[] }) => p?.packageDocuments?.[0]?.encodedLabel)
          .filter(Boolean) as string[] | undefined;
        const labelBase64 = allLabels?.[0];
        console.log(`[FedEx API] Order ${order.salesRecordNumber}: tracking=${trackingNumber}, labels=${allLabels?.length ?? 0}`);
        return { ok: true, orderId: order.id, salesRecordNumber: order.salesRecordNumber, trackingNumber, labelBase64, allLabels, labelPdfs: allLabels };
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error(`[FedEx API] Order ${order.salesRecordNumber} FAILED: ${errorMsg}`);
        console.error(`[FedEx API] Order ${order.salesRecordNumber} address: ${order.postToAddress1}, ${order.postToAddress2}, ${order.postToCity}, ${order.postToCounty}, ${order.postToPostcode}, ${order.postToCountry}`);
        return { ok: false, orderId: order.id, salesRecordNumber: order.salesRecordNumber, error: errorMsg };
      }
    })
  );

  const succeeded = results.filter((r): r is Extract<ShipResult, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<ShipResult, { ok: false }> => !r.ok).map((r) => ({ orderId: r.orderId, error: r.error }));

  return NextResponse.json({ succeeded, failed });
}
