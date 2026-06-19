import { NextRequest, NextResponse } from 'next/server';
import { createFedExShipment, FedExShipmentRequest } from '@/lib/fedex-client';
import { Order } from '@/lib/types';

function notConfigured() {
  return !process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET || !process.env.FEDEX_ACCOUNT_NUMBER;
}

function sanitizeFedExString(value: string, maxLength: number): string {
  return (value || '').trim().slice(0, maxLength);
}

function sanitizeFedExPhone(value: string): string {
  return (value || '').replace(/\D/g, '').slice(0, 15);
}

function sanitizeFedExAddressLines(address1: string, address2: string): string[] {
  const line1 = sanitizeFedExString(address1, 35);
  const line2 = sanitizeFedExString(address2, 35);
  const lines: string[] = [];
  if (line1.length >= 3) lines.push(line1);
  if (line2.length >= 3) lines.push(line2);

  // If address line 1 is too short, merge with line 2 if possible
  if (line1.length > 0 && line1.length < 3 && line2.length >= 3) {
    const combined = sanitizeFedExString(`${line1} ${line2}`, 35);
    if (combined.length >= 3) return [combined];
  }

  if (lines.length > 0) return lines;

  // Fallback for empty/invalid addresses
  return ['Unknown Address'];
}

function ensureMinLength(value: string, minLength: number, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= minLength) return trimmed;
  return fallback;
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
    streetLines: sanitizeFedExAddressLines(order.postToAddress1, order.postToAddress2),
    city: ensureMinLength(sanitizeFedExString(order.postToCity, 35), 3, sanitizeFedExString(order.postToCounty || '', 35) || 'Unknown'),
    stateOrProvinceCode: order.postToCounty ? sanitizeFedExString(order.postToCounty, 3) : undefined,
    postalCode: sanitizeFedExString(order.postToPostcode, 16),
    countryCode: order.postToCountry === 'United Kingdom' ? 'GB' : (order.postToCountry || 'GB'),
  };

  const shipperAddress = {
    streetLines: sanitizeFedExAddressLines(process.env.FEDEX_SHIPPER_ADDRESS1 || '', process.env.FEDEX_SHIPPER_ADDRESS2 || ''),
    city: ensureMinLength(sanitizeFedExString(process.env.FEDEX_SHIPPER_CITY || '', 35), 3, 'Unknown'),
    postalCode: sanitizeFedExString(process.env.FEDEX_SHIPPER_POSTCODE || '', 16),
    countryCode: 'GB',
  };

  const recipientPhone = sanitizeFedExPhone(order.postToPhone || '');
  const recipientName = sanitizeFedExString(order.postToName || order.buyerUsername || '', 35);

  return {
    shipDatestamp: shipDate,
    serviceType,
    packagingType: 'YOUR_PACKAGING',
    pickupType: 'USE_SCHEDULED_PICKUP',
    shipper: {
      contact: {
        personName: sanitizeFedExString(process.env.FEDEX_SHIPPER_NAME || 'Warehouse', 35),
        phoneNumber: sanitizeFedExPhone(process.env.FEDEX_SHIPPER_PHONE || '').replace(/^$/, '0000000000'),
        companyName: sanitizeFedExString(process.env.FEDEX_SHIPPER_COMPANY || '', 35),
      },
      address: shipperAddress,
    },
    recipients: [
      {
        contact: {
          personName: ensureMinLength(recipientName, 3, 'Recipient'),
          phoneNumber: recipientPhone.replace(/^$/, '0000000000'),
          emailAddress: sanitizeFedExString(order.buyerEmail || '', 100),
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
        { customerReferenceType: 'CUSTOMER_REFERENCE' as const, value: sanitizeFedExString(order.salesRecordNumber, 30) },
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

  type ShipResult = { ok: true; orderId: string; salesRecordNumber: string; trackingNumber?: string; labelBase64?: string; allLabels?: string[]; labelPdfs?: string[] } | { ok: false; orderId: string; salesRecordNumber: string; error: string };

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
        console.log(`[FedEx API] Order ${order.salesRecordNumber}: tracking=${trackingNumber}, labels=${allLabels?.length ?? 0}`);
        return { ok: true, orderId: order.id, salesRecordNumber: order.salesRecordNumber, trackingNumber, labelBase64, allLabels, labelPdfs: allLabels };
      } catch (e) {
        return { ok: false, orderId: order.id, salesRecordNumber: order.salesRecordNumber, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );

  const succeeded = results.filter((r): r is Extract<ShipResult, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<ShipResult, { ok: false }> => !r.ok).map((r) => ({ orderId: r.orderId, error: r.error }));

  return NextResponse.json({ succeeded, failed });
}
