/**
 * DPD API client
 * Docs: https://developer.dpd.co.uk/
 * 
 * Authentication Flow:
 * 1. Obtain Access Token using API Key + Secret Key
 * 2. Use Access Token for all API calls
 *
 * Fill in .env.local:
 *   DPD_API_KEY=your_api_key
 *   DPD_API_SECRET=your_secret_key
 *   DPD_ACCOUNT_NUMBER=your_account_number
 *   DPD_ENV=staging (or production)
 */

// DPD API base URL - determined at runtime
function getIsSandbox(): boolean {
  const env = process.env.DPD_ENV?.toLowerCase();
  return env === 'staging' || env === 'sandbox';
}

function getBaseUrl(): string {
  return getIsSandbox()
    ? 'https://developers.api.customers.dpd.co.uk'  // Sandbox
    : 'https://api.customers.dpd.co.uk';            // Production
}

// Cache for access token
let cachedToken: { token: string; expiresAt: number } | null = null;

interface DPDTokenResponse {
  data: {
    accessToken: string;
    refreshToken: string;
    expiry: number;  // Unix timestamp
  };
}

/**
 * Obtain Access Token from DPD Auth Service using API Key + Secret
 */
async function getAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const apiKey = process.env.DPD_API_KEY;
  const apiSecret = process.env.DPD_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('DPD_API_KEY and DPD_API_SECRET must be set in environment');
  }

  console.log('[DPD] Obtaining access token...');

  // DPD uses Basic auth with API key as username and secret as password
  const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

  const isSandbox = getIsSandbox();
  const baseUrl = getBaseUrl();
  
  // DPD v1 Auth endpoint
  const tokenUrl = `${baseUrl}/v1/customer/auth/access`;
  console.log(`[DPD] Requesting token from: ${tokenUrl} (sandbox: ${isSandbox})`);
  
  const res = await fetch(tokenUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
      'Client-Id': apiKey,
    },
  }).catch(err => {
    console.error('[DPD] Token fetch error:', err);
    throw new Error(`Token fetch failed: ${err.message}`);
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[DPD] Token request failed ${res.status}:`, body);
    throw new Error(`DPD token request failed ${res.status}: ${body}`);
  }

  const response = await res.json() as DPDTokenResponse;
  
  if (!response.data?.accessToken) {
    throw new Error(`DPD token response missing accessToken: ${JSON.stringify(response)}`);
  }

  // Cache token until expiry (convert Unix timestamp to milliseconds)
  const expiresAt = response.data.expiry * 1000;
  cachedToken = {
    token: response.data.accessToken,
    expiresAt: expiresAt - 5 * 60 * 1000, // 5 min buffer
  };

  console.log('[DPD] Access token obtained successfully');
  return response.data.accessToken;
}

/**
 * Get headers for DPD API request with Bearer token
 */
async function getDPDHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const apiKey = process.env.DPD_API_KEY;
  const accountNumber = process.env.DPD_ACCOUNT_NUMBER;
  
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  
  // Client-Id is the API Key (required for all API calls per docs)
  if (apiKey) {
    headers['Client-Id'] = apiKey;
  }
  
  // GeoClient is account number (legacy DPD header)
  if (accountNumber) {
    headers['GeoClient'] = `account/${accountNumber}`;
  }
  
  return headers;
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
  outboundConsignment: {
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
      products?: {
        product: {
          productCode: string; // e.g. "N" = Next Day, "2" = Two Day
        };
      }[];
      networkCode: string; // e.g. "1^12" = Next Day, "1^13" = Pre-12
      numberOfParcels: number;
      totalWeight: number;
      shippingRef1?: string;
      shippingRef2?: string;
      shippingRef3?: string;
    }[];
  };
}

export interface DPDShipmentResponse {
  data?: {
    shipmentId?: string;
    consignments?: {
      consignmentNumber: string;
      parcelNumber: string[];
    }[];
  };
  error?: {
    errorCode: number;
    errorMessage: string;
  };
}

export interface DPDOutboundServicesInput {
  collectionPostcode: string;
  collectionTown: string;
  collectionCounty?: string;
  collectionCountryCode: string;
  deliveryPostcode: string;
  deliveryTown: string;
  deliveryCounty?: string;
  deliveryCountryCode: string;
  totalWeight: number;
  numberOfParcels: number;
}

export interface DPDOutboundService {
  networkKey: string;
  networkCode?: string;
  networkDesc?: string;
  serviceName?: string;
  serviceDescription?: string;
  service?: { serviceDesc?: string; serviceKey?: string };
  product?: { productDesc?: string; productKey?: string };
  [key: string]: unknown;
}

export async function validateDpdOutboundServices(input: DPDOutboundServicesInput): Promise<DPDOutboundService[]> {
  const headers = await getDPDHeaders();
  const baseUrl = getBaseUrl();

  const requestBody = {
    deliveryDetails: {
      address: {
        countryCode: input.deliveryCountryCode,
        town: input.deliveryTown,
        postcode: input.deliveryPostcode,
        county: input.deliveryCounty ?? '',
      },
    },
    collectionDetails: {
      address: {
        countryCode: input.collectionCountryCode,
        town: input.collectionTown,
        postcode: input.collectionPostcode,
        county: input.collectionCounty ?? '',
      },
    },
    totalWeight: input.totalWeight,
    shipmentType: 0,
    numberOfParcels: input.numberOfParcels,
  };

  console.log('[DPD] Validating outbound services...');
  console.log('[DPD] Collection postcode:', input.collectionPostcode);
  console.log('[DPD] Delivery postcode:', input.deliveryPostcode);
  console.log('[DPD] Total weight:', input.totalWeight);
  console.log('[DPD] Number of parcels:', input.numberOfParcels);

  const url = `${baseUrl}/v1/customer/shipping/reference/outboundservices`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  }).catch(err => {
    throw new Error(`Outbound services fetch failed: ${err.message}`);
  });

  const responseText = await res.text();
  console.log(`[DPD] Outbound services response ${res.status}:`, responseText.substring(0, 1000));

  if (!res.ok) {
    throw new Error(`DPD outbound services error ${res.status}: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  console.log('[DPD] Outbound services response:', JSON.stringify(data, null, 2));

  // DPD returns services in data array
  const services: DPDOutboundService[] = Array.isArray(data?.data) ? data.data : [];
  return services;
}

export async function createDPDShipment(payload: DPDShipmentRequest): Promise<DPDShipmentResponse> {
  const accountNumber = process.env.DPD_ACCOUNT_NUMBER;
  if (!accountNumber) throw new Error('DPD_ACCOUNT_NUMBER not set in environment');

  const headers = await getDPDHeaders();
  const baseUrl = getBaseUrl();
  
  // DPD v1 API endpoint for creating domestic shipments (UK, Ireland, Channel Islands)
  const shipmentUrl = `${baseUrl}/v1/customer/shipping/shipments/domestic`;
  console.log(`[DPD] Creating shipment at: ${shipmentUrl}`);

  const res = await fetch(shipmentUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }).catch(err => {
    console.error('[DPD] Shipment fetch error:', err);
    throw new Error(`Shipment fetch failed: ${err.message}`);
  });

  const responseText = await res.text();
  console.log(`[DPD] Shipment response ${res.status}:`, responseText.substring(0, 500));

  if (!res.ok) {
    throw new Error(`DPD API error ${res.status}: ${responseText}`);
  }

  if (!responseText) {
    throw new Error('DPD API returned empty response');
  }

  const data = JSON.parse(responseText) as DPDShipmentResponse;
  console.log(`[DPD] Shipment created successfully`);
  return data;
}

export type DPDLabelResult =
  | { type: 'html'; data: string }
  | { type: 'pdf'; base64: string };

export async function getDPDLabels(shipmentId: string): Promise<DPDLabelResult[]> {
  const apiKey = process.env.DPD_API_KEY;
  const accountNumber = process.env.DPD_ACCOUNT_NUMBER;
  const token = await getAccessToken();
  const baseUrl = getBaseUrl();

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
  };
  if (apiKey) headers['Client-Id'] = apiKey;
  if (accountNumber) headers['GeoClient'] = `account/${accountNumber}`;

  // printerType=0 + Accept: application/json → JSON array of raw HTML labels
  const url = `${baseUrl}/v1/customer/shipping/shipments/${shipmentId}/labels?printerType=0`;
  console.log(`[DPD] Fetching label: ${url}`);

  const res = await fetch(url, { headers })
    .catch(err => { throw new Error(`Label fetch failed: ${err.message}`); });

  const body = await res.text();
  console.log(`[DPD] Label response: ${res.status}, content-type: ${res.headers.get('content-type')}, length: ${body.length}`);

  if (!res.ok) {
    throw new Error(`DPD label fetch failed ${res.status}: ${body.slice(0, 200)}`);
  }

  // Parse JSON array response: { data: { printString: string[] } }
  try {
    const json = JSON.parse(body);
    const printStrings: string[] = json?.data?.printString ?? [];
    if (printStrings.length > 0) {
      console.log(`[DPD] Got ${printStrings.length} HTML label(s)`);
      return printStrings.map((data) => ({ type: 'html', data }));
    }
  } catch {
    // not JSON — raw body is the label
  }

  if (body.trim()) {
    console.log(`[DPD] Got raw HTML label (${body.length} chars)`);
    return [{ type: 'html', data: body }];
  }

  throw new Error('DPD returned no label data');
}

export interface DPDTrackingResponse {
  data: {
    trackingInfo?: {
      trackingResult?: {
        consignmentNumber?: string;
        parcelInfo?: {
          trackingNumber?: string;
          events?: {
            date: string;
            time: string;
            description: string;
            location?: string;
          }[];
        }[];
      };
    };
  };
  errors?: string[];
}

export async function trackDPDShipment(trackingNumber: string): Promise<DPDTrackingResponse> {
  const baseUrl = getBaseUrl();
  const token = await getAccessToken();

  const res = await fetch(`${baseUrl}/shipping/tracking?trackingNumber=${encodeURIComponent(trackingNumber)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DPD tracking API error: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data as DPDTrackingResponse;
}

// ==================== RETURNS API ====================
// DPD's dedicated Returns API: the returnee drops the parcel at a DPD Pickup
// location using a printed label or a 2D barcode. GB mainland only.

export interface DPDReturnRequest {
  outboundConsignment: {
    collectionDetails: { contactDetails: DPDContact; address: DPDAddress };
    deliveryDetails: { contactDetails: DPDContact; address: DPDAddress };
    numberOfParcels: number;
    totalWeight: number;
    shipmentDate: string;       // "2026-06-30T17:53:16"
    shippingRef1?: string;      // max 25 chars
  };
}

export interface DPDReturnResponse {
  data?: {
    shipmentId?: string;
    consignments?: { consignmentNumber: string; parcelNumber: string[] }[];
  };
  error?: { code: number; type: string; message: string; fieldPath?: string }[];
}

export interface DPDReturnBarcode {
  parcelNumber: string;
  imageData: string;   // base64
  imageFormat: string; // e.g. "png"
}

function returnHeaders(token: string, accept: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: accept };
  if (process.env.DPD_API_KEY) headers['Client-Id'] = process.env.DPD_API_KEY;
  if (process.env.DPD_ACCOUNT_NUMBER) headers['GeoClient'] = `account/${process.env.DPD_ACCOUNT_NUMBER}`;
  return headers;
}

// POST /v1/customer/return/shipment
export async function createDPDReturn(payload: DPDReturnRequest, sendEmail = false): Promise<DPDReturnResponse> {
  if (!process.env.DPD_ACCOUNT_NUMBER) throw new Error('DPD_ACCOUNT_NUMBER not set in environment');
  const headers = await getDPDHeaders();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/customer/return/shipment${sendEmail ? '?sendEmail=true' : ''}`;
  console.log('[DPD return] creating return at:', url);

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  const text = await res.text();
  console.log(`[DPD return] create response ${res.status}:`, text.slice(0, 500));
  if (!res.ok) throw new Error(`DPD return create error ${res.status}: ${text}`);
  return JSON.parse(text) as DPDReturnResponse;
}

// GET /v1/customer/return/shipment/{shipmentId}/label  → HTML (or PDF) label document
export async function getDPDReturnLabel(shipmentId: string, sendEmail = false): Promise<string> {
  const token = await getAccessToken();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/customer/return/shipment/${shipmentId}/label${sendEmail ? '?sendEmail=true' : ''}`;
  const res = await fetch(url, { headers: returnHeaders(token, 'text/html') });
  const body = await res.text();
  if (!res.ok) throw new Error(`DPD return label error ${res.status}: ${body.slice(0, 300)}`);
  return body;
}

// GET /v1/customer/return/shipment/{shipmentId}/barcode  → base64 2D barcode image(s)
export async function getDPDReturnBarcode(shipmentId: string, sendEmail = false): Promise<DPDReturnBarcode[]> {
  const token = await getAccessToken();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/customer/return/shipment/${shipmentId}/barcode${sendEmail ? '?sendEmail=true' : ''}`;
  const res = await fetch(url, { headers: returnHeaders(token, 'application/json') });
  const body = await res.text();
  if (!res.ok) throw new Error(`DPD return barcode error ${res.status}: ${body.slice(0, 300)}`);
  const json = JSON.parse(body) as { data?: { barcodes?: { parcelNumber: string; barcodeImage?: { imageData: string; imageFormat: string } }[] } };
  return (json.data?.barcodes ?? []).map((b) => ({
    parcelNumber: b.parcelNumber,
    imageData: b.barcodeImage?.imageData ?? '',
    imageFormat: b.barcodeImage?.imageFormat ?? 'png',
  }));
}
