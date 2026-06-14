/**
 * DPD API client
 * Docs: https://developer.dpd.co.uk/
 *
 * Fill in .env.local:
 *   DPD_API_USER, DPD_API_PASSWORD, DPD_ACCOUNT_NUMBER, DPD_ENV (staging|production)
 */

const BASE = 'https://api.dpd.co.uk';

let cachedSession: { token: string; expiresAt: number } | null = null;

/**
 * DPD UK auth: POST /user/?action=login with Basic auth.
 * Returns a GeoSession token valid for the session (we cache for 50 mins).
 */
async function getDPDSession(): Promise<string> {
  if (cachedSession && Date.now() < cachedSession.expiresAt) {
    return cachedSession.token;
  }

  const user = process.env.DPD_API_USER;
  const pass = process.env.DPD_API_PASSWORD;
  if (!user || !pass) throw new Error('DPD_API_USER or DPD_API_PASSWORD not set in environment');

  const accountNumber = process.env.DPD_ACCOUNT_NUMBER;
  const res = await fetch(`${BASE}/user/?action=login`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(accountNumber ? { 'GeoClient': `account/${accountNumber}` } : {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DPD login failed ${res.status}: ${body}`);
  }

  const data = await res.json() as { data?: { geoSession?: string }; error?: { errorMessage: string } };
  const token = data?.data?.geoSession;
  if (!token) throw new Error(`DPD login: no geoSession in response — ${JSON.stringify(data)}`);

  cachedSession = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return token;
}

export interface DPDAddress {
  organisation?: string;
  street: string;
  locality?: string;
  town: string;
  county?: string;
  postcode: string;
  countryCode: string;
}

export interface DPDContact {
  contactName: string;
  telephone?: string;
  email?: string;
}

export interface DPDParcel {
  weight: number; // kg
}

export interface DPDShipmentRequest {
  jobId?: string;
  collectionOnDelivery: boolean;
  invoice?: { invoiceType: string };
  collectionDate: string; // ISO date string e.g. "2024-06-15T00:00:00"
  consolidate: boolean;
  consignment: {
    consignmentNumber?: string;
    consignmentRef: string;
    parcel: DPDParcel[];
    collectionDetails: {
      contactDetails: DPDContact;
      address: DPDAddress;
    };
    deliveryDetails: {
      contactDetails: DPDContact;
      address: DPDAddress;
      notificationDetails?: {
        mobile?: string;
        email?: string;
      };
    };
    networkCode: string; // e.g. "1^12" = Next Day, "1^13" = Pre-12
    numberOfParcels: number;
    totalWeight: number;
    shippingRef1?: string;
    shippingRef2?: string;
    shippingRef3?: string;
  }[];
}

export interface DPDShipmentResponse {
  data?: {
    shipmentId?: string;
    consignment?: {
      consignmentNumber: string;
      parcel: {
        parcelNumber: string;
        label: string; // base64 PDF
      }[];
    }[];
  };
  error?: {
    errorCode: number;
    errorMessage: string;
  };
}

export async function createDPDShipment(payload: DPDShipmentRequest): Promise<DPDShipmentResponse> {
  const accountNumber = process.env.DPD_ACCOUNT_NUMBER;
  if (!accountNumber) throw new Error('DPD_ACCOUNT_NUMBER not set in environment');

  const session = await getDPDSession();

  const res = await fetch(`${BASE}/shipping/shipment`, {
    method: 'POST',
    headers: {
      'GeoSession': session,
      'GeoClient': `account/${accountNumber}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json() as DPDShipmentResponse;

  if (!res.ok) {
    throw new Error(`DPD API error ${res.status}: ${data.error?.errorMessage || JSON.stringify(data)}`);
  }

  return data;
}

export async function getDPDLabel(parcelNumber: string): Promise<Buffer> {
  const accountNumber = process.env.DPD_ACCOUNT_NUMBER!;
  const session = await getDPDSession();

  const res = await fetch(`${BASE}/shipping/label/${parcelNumber}`, {
    headers: {
      'GeoSession': session,
      'GeoClient': `account/${accountNumber}`,
      'Accept': 'application/pdf',
    },
  });

  if (!res.ok) throw new Error(`DPD label fetch failed: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
