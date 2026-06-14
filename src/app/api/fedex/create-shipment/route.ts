import { NextRequest, NextResponse } from 'next/server';
import { createFedExShipment, FedExShipmentRequest } from '@/lib/fedex-client';
import { Order } from '@/lib/types';

function notConfigured() {
  return !process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET || !process.env.FEDEX_ACCOUNT_NUMBER;
}

function orderToPayload(order: Order, shipDate: string): FedExShipmentRequest {
  const isInternational = order.postToCountry !== 'United Kingdom' && order.postToCountry !== 'GB';
  const isNextDay = order.deliveryType === 'next_day' || order.deliveryType === 'express';
  const serviceType = isInternational
    ? 'INTERNATIONAL_ECONOMY'
    : isNextDay
    ? 'FEDEX_PRIORITY_EXPRESS'  // next day by noon, Europe domestic
    : 'FEDEX_PRIORITY';         // end of day standard, Europe domestic
  const numberOfBoxes = order.numberOfBoxes ?? 1;

  const recipientAddress = {
    streetLines: [order.postToAddress1, order.postToAddress2].filter(Boolean) as string[],
    city: order.postToCity,
    stateOrProvinceCode: order.postToCounty || undefined,
    postalCode: order.postToPostcode,
    countryCode: order.postToCountry === 'United Kingdom' ? 'GB' : (order.postToCountry || 'GB'),
  };

  const shipperAddress = {
    streetLines: [(process.env.FEDEX_SHIPPER_ADDRESS1 || '')],
    city: process.env.FEDEX_SHIPPER_CITY || '',
    postalCode: process.env.FEDEX_SHIPPER_POSTCODE || '',
    countryCode: 'GB',
  };

  return {
    shipDatestamp: shipDate,
    serviceType,
    packagingType: 'YOUR_PACKAGING',
    pickupType: 'USE_SCHEDULED_PICKUP',
    shipper: {
      contact: {
        personName: process.env.FEDEX_SHIPPER_NAME || 'Warehouse',
        phoneNumber: process.env.FEDEX_SHIPPER_PHONE || '',
        companyName: process.env.FEDEX_SHIPPER_COMPANY || '',
      },
      address: shipperAddress,
    },
    recipients: [
      {
        contact: {
          personName: order.postToName,
          phoneNumber: order.postToPhone || '',
          emailAddress: order.buyerEmail || '',
        },
        address: recipientAddress,
      },
    ],
    shippingChargesPayment: {
      paymentType: 'SENDER',
      payor: {
        responsibleParty: {
          accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER! },
        },
      },
    },
    labelSpecification: {
      labelFormatType: 'COMMON2D',
      imageType: 'PDF',
      labelStockType: 'PAPER_85X11_TOP_HALF_LABEL',
    },
    requestedPackageLineItems: Array.from({ length: numberOfBoxes }, () => ({
      weight: { units: 'KG' as const, value: 1 },
      customerReferences: [
        { customerReferenceType: 'CUSTOMER_REFERENCE' as const, value: order.salesRecordNumber },
      ],
    })),
  };
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

  type ShipResult = { ok: true; orderId: string; salesRecordNumber: string; trackingNumber?: string; labelBase64?: string; allLabels?: string[] } | { ok: false; orderId: string; salesRecordNumber: string; error: string };

  const results: ShipResult[] = await Promise.all(
    orders.map(async (order): Promise<ShipResult> => {
      try {
        const payload = orderToPayload(order, shipDate);
        const res = await createFedExShipment(payload);
        const shipment = res.output?.transactionShipments?.[0];
        const trackingNumber = shipment?.masterTrackingNumber;
        const allLabels = shipment?.pieceResponses
          ?.map((p: { packageDocuments?: { encodedLabel?: string }[] }) => p?.packageDocuments?.[0]?.encodedLabel)
          .filter(Boolean) as string[] | undefined;
        const labelBase64 = allLabels?.[0];
        return { ok: true, orderId: order.id, salesRecordNumber: order.salesRecordNumber, trackingNumber, labelBase64, allLabels };
      } catch (e) {
        return { ok: false, orderId: order.id, salesRecordNumber: order.salesRecordNumber, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );

  const succeeded = results.filter((r): r is Extract<ShipResult, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<ShipResult, { ok: false }> => !r.ok).map((r) => ({ orderId: r.orderId, error: r.error }));

  return NextResponse.json({ succeeded, failed });
}
