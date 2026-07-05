import { FedExShipmentRequest } from './fedex-client';
import { Order } from './types';

// Builds the FedEx requestedShipment payload from an order. Shared by the label
// booking route and the rate-quote route so a quote reflects what we'd book.

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

  if (line1.length > 0 && line1.length < 3 && line2.length >= 3) {
    const combined = sanitizeFedExString(`${line1} ${line2}`, 35);
    if (combined.length >= 3) return [combined];
  }

  if (lines.length > 0) return lines;
  return ['Unknown Address'];
}

function ensureMinLength(value: string, minLength: number, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= minLength) return trimmed;
  return fallback;
}

// FedEx rates are weight-driven, but orders don't carry a parcel weight — only a
// box count. Use a per-box default weight (KG) that can be tuned via env without a
// code change, e.g. FEDEX_DEFAULT_PARCEL_KG=2.5. Falls back to 1 KG.
function defaultParcelWeightKg(): number {
  const raw = Number(process.env.FEDEX_DEFAULT_PARCEL_KG);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

function sanitizePostcode(postcode: string): string {
  return (postcode || '').trim().toUpperCase();
}

function normalizeUKPostcode(postcode: string): string | null {
  const cleaned = postcode.replace(/\s+/g, '').toUpperCase();
  const match = cleaned.match(/^([A-Z]{1,2})([0-9][A-Z0-9]?)([0-9][A-Z]{2})$/);
  if (!match) return null;
  const [, area, district, inward] = match;
  return `${area}${district} ${inward}`;
}

export function buildFedExShipmentPayload(order: Order, shipDate: string): FedExShipmentRequest {
  const isInternational = order.postToCountry !== 'United Kingdom' && order.postToCountry !== 'GB';
  const isNextDay = order.deliveryType === 'next_day' || order.deliveryType === 'express';
  const serviceType = isInternational
    ? 'INTERNATIONAL_ECONOMY'
    : isNextDay
    ? 'FEDEX_PRIORITY_EXPRESS'
    : 'FEDEX_PRIORITY';
  const numberOfBoxes = order.numberOfBoxes ?? 1;

  const countryCode = order.postToCountry === 'United Kingdom' ? 'GB' : (order.postToCountry || 'GB');
  const rawRecipientPostcode = sanitizePostcode(order.postToPostcode || '');
  const normalizedUKPostcode = countryCode === 'GB' ? normalizeUKPostcode(rawRecipientPostcode) : null;
  const recipientPostcode = countryCode === 'GB'
    ? (normalizedUKPostcode || 'AA1 1AA')
    : (rawRecipientPostcode || '00000');
  const shipperPostcode = sanitizePostcode(process.env.FEDEX_SHIPPER_POSTCODE || '') || 'AA1 1AA';

  const recipientAddress = {
    streetLines: sanitizeFedExAddressLines(order.postToAddress1, order.postToAddress2),
    city: ensureMinLength(sanitizeFedExString(order.postToCity, 35), 3, sanitizeFedExString(order.postToCounty || '', 35) || 'Unknown'),
    stateOrProvinceCode: order.postToCounty ? sanitizeFedExString(order.postToCounty, 3) : undefined,
    postalCode: recipientPostcode,
    countryCode,
  };

  const shipperAddress = {
    streetLines: sanitizeFedExAddressLines(process.env.FEDEX_SHIPPER_ADDRESS1 || '', process.env.FEDEX_SHIPPER_ADDRESS2 || ''),
    city: ensureMinLength(sanitizeFedExString(process.env.FEDEX_SHIPPER_CITY || '', 35), 3, 'Unknown'),
    postalCode: shipperPostcode,
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
      labelStockType: 'PAPER_4X6',
    },
    requestedPackageLineItems: Array.from({ length: numberOfBoxes }, () => ({
      weight: { units: 'KG' as const, value: defaultParcelWeightKg() },
      customerReferences: [
        { customerReferenceType: 'CUSTOMER_REFERENCE' as const, value: sanitizeFedExString(order.salesRecordNumber, 30) },
      ],
    })),
  };
}
