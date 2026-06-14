import { NextRequest, NextResponse } from 'next/server';
import { createDPDShipment, DPDShipmentRequest } from '@/lib/dpd-client';
import { Order } from '@/lib/types';

function notConfigured() {
  return !process.env.DPD_API_USER || !process.env.DPD_API_PASSWORD || !process.env.DPD_ACCOUNT_NUMBER;
}

function orderToPayload(order: Order, collectionDate: string): DPDShipmentRequest {
  const networkCode = (order.deliveryType === 'next_day' || order.deliveryType === 'express') ? '1^12' : '1^13';
  const numberOfBoxes = order.numberOfBoxes ?? 1;

  return {
    collectionOnDelivery: false,
    collectionDate: `${collectionDate}T00:00:00`,
    consolidate: false,
    consignment: [
      {
        consignmentRef: order.salesRecordNumber,
        parcel: Array.from({ length: numberOfBoxes }, () => ({ weight: 1 })),
        collectionDetails: {
          contactDetails: {
            contactName: 'Warehouse',
            telephone: process.env.DPD_COLLECTION_PHONE || '',
          },
          address: {
            street: process.env.DPD_COLLECTION_ADDRESS1 || '',
            town: process.env.DPD_COLLECTION_CITY || '',
            postcode: process.env.DPD_COLLECTION_POSTCODE || '',
            countryCode: 'GB',
          },
        },
        deliveryDetails: {
          contactDetails: {
            contactName: order.postToName,
            telephone: order.postToPhone || '',
            email: order.buyerEmail || '',
          },
          address: {
            street: order.postToAddress1,
            locality: order.postToAddress2 || undefined,
            town: order.postToCity,
            county: order.postToCounty || undefined,
            postcode: order.postToPostcode,
            countryCode: order.postToCountry === 'United Kingdom' ? 'GB' : (order.postToCountry || 'GB'),
          },
          notificationDetails: {
            mobile: order.postToPhone || undefined,
            email: order.buyerEmail || undefined,
          },
        },
        networkCode,
        numberOfParcels: numberOfBoxes,
        totalWeight: numberOfBoxes,
        shippingRef1: order.salesRecordNumber,
      },
    ],
  };
}

export async function POST(req: NextRequest) {
  if (notConfigured()) {
    return NextResponse.json(
      { error: 'not_configured', message: 'DPD API credentials not set. Fill in DPD_API_USER, DPD_API_PASSWORD, DPD_ACCOUNT_NUMBER in .env.local.' },
      { status: 503 }
    );
  }

  const body = await req.json() as { orders: Order[]; collectionDate?: string };
  const { orders, collectionDate = new Date().toISOString().slice(0, 10) } = body;

  if (!orders?.length) {
    return NextResponse.json({ error: 'No orders provided' }, { status: 400 });
  }

  type ShipResult = { ok: true; orderId: string; salesRecordNumber: string; consignmentNumber?: string; parcelNumber?: string; labelBase64?: string } | { ok: false; orderId: string; salesRecordNumber: string; error: string };

  const results: ShipResult[] = await Promise.all(
    orders.map(async (order): Promise<ShipResult> => {
      try {
        const payload = orderToPayload(order, collectionDate);
        const res = await createDPDShipment(payload);
        const consignment = res.data?.consignment?.[0];
        return { ok: true, orderId: order.id, salesRecordNumber: order.salesRecordNumber, consignmentNumber: consignment?.consignmentNumber, parcelNumber: consignment?.parcel?.[0]?.parcelNumber, labelBase64: consignment?.parcel?.[0]?.label };
      } catch (e) {
        return { ok: false, orderId: order.id, salesRecordNumber: order.salesRecordNumber, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );

  const succeeded = results.filter((r): r is Extract<ShipResult, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<ShipResult, { ok: false }> => !r.ok).map((r) => ({ orderId: r.orderId, error: r.error }));

  return NextResponse.json({ succeeded, failed });
}
