/**
 * FedEx Ship API v1 client
 * Docs: https://developer.fedex.com/api/en-gb/catalog/ship/v1/docs.html
 *
 * Fill in .env.local:
 *   FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET, FEDEX_ACCOUNT_NUMBER, FEDEX_ENV (sandbox|production)
 */

const SANDBOX_BASE = 'https://apis-sandbox.fedex.com';
const PROD_BASE = 'https://apis.fedex.com';

function getBase(): string {
  return process.env.FEDEX_ENV === 'production' ? PROD_BASE : SANDBOX_BASE;
}

let _cachedToken: { token: string; expiresAt: number } | null = null;

export async function getFedExToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) {
    return _cachedToken.token;
  }

  const clientId = process.env.FEDEX_CLIENT_ID;
  const clientSecret = process.env.FEDEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('FEDEX_CLIENT_ID or FEDEX_CLIENT_SECRET not set');

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${getBase()}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (res.ok) {
        const data = await res.json() as { access_token: string; expires_in: number };
        _cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
        console.log(`[FedEx] Auth succeeded on attempt ${attempt + 1}`);
        return data.access_token;
      }

      const body = await res.text();
      const isRetryable = res.status === 403 || res.status === 429 || res.status === 502 || res.status === 503;
      
      if (isRetryable && attempt < maxRetries) {
        console.warn(`[FedEx] Auth failed with retryable status ${res.status}, retrying attempt ${attempt + 1}: ${body.slice(0, 100)}...`);
        lastError = new Error(`FedEx auth failed: ${res.status} ${body}`);
        const delay = 1000 * Math.pow(2, attempt) + Math.random() * 1000; // Add jitter
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw new Error(`FedEx auth failed: ${res.status} ${body}`);
    } catch (err) {
      if (attempt === maxRetries) {
        console.error('[FedEx] Auth max retries exceeded:', err);
        throw lastError || err instanceof Error ? err : new Error(String(err));
      }
      if (err instanceof Error && !err.message.includes('FedEx auth failed')) {
        // Network or other errors that aren't from the auth response itself
        console.warn(`[FedEx] Auth network error on attempt ${attempt + 1}, retrying:`, err);
        lastError = err;
        const delay = 1000 * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('FedEx authentication failed after retries');
}

export interface FedExAddress {
  streetLines: string[];
  city: string;
  stateOrProvinceCode?: string;
  postalCode: string;
  countryCode: string;
}

export interface FedExContact {
  personName: string;
  phoneNumber?: string;
  emailAddress?: string;
  companyName?: string;
}

export interface FedExShipmentRequest {
  shipDatestamp: string; // "YYYY-MM-DD"
  serviceType:
    | 'INTERNATIONAL_ECONOMY'      // GB → overseas, 2-5 days
    | 'INTERNATIONAL_PRIORITY'     // GB → overseas, 1-3 days
    | 'FEDEX_PRIORITY_EXPRESS'     // UK/Europe domestic, next day by noon
    | 'FEDEX_PRIORITY'             // UK/Europe domestic, end of day
    | 'FEDEX_ECONOMY';             // UK/Europe domestic, 3 days
  packagingType: 'YOUR_PACKAGING';
  pickupType: 'USE_SCHEDULED_PICKUP' | 'DROPOFF_AT_FEDEX_LOCATION';
  shipper: {
    contact: FedExContact;
    address: FedExAddress;
  };
  recipients: {
    contact: FedExContact;
    address: FedExAddress;
  }[];
  shippingChargesPayment: {
    paymentType: 'SENDER';
    payor: { responsibleParty: { accountNumber: { value: string } } };
  };
  labelSpecification: {
    labelFormatType: 'COMMON2D';
    imageType: 'PDF';
    labelStockType:
      | 'PAPER_4X6'
      | 'PAPER_4X8.25'
      | 'PAPER_4X9'
      | 'PAPER_4X11'
      | 'PAPER_8.5X11_BOTTOM_HALF_LABEL'
      | 'PAPER_8.5X11_TOP_HALF_LABEL'
      | 'PAPER_85X11_TOP_HALF_LABEL';
  };
  requestedPackageLineItems: {
    weight: { units: 'KG'; value: number };
    dimensions?: { length: number; width: number; height: number; units: 'CM' };
    customerReferences?: { customerReferenceType: 'CUSTOMER_REFERENCE'; value: string }[];
  }[];
}

export interface FedExShipmentResponse {
  output?: {
    transactionShipments?: {
      masterTrackingNumber: string;
      serviceType?: string;
      pieceResponses?: {
        masterTrackingNumber: string;
        trackingNumber: string;
        packageDocuments?: {
          contentType: string;
          copiesToPrint: number;
          encodedLabel: string; // base64 PDF
          docType: string;
        }[];
      }[];
      completedShipmentDetail?: {
        completedPackageDetails?: {
          trackingIds?: { trackingNumber: string }[];
        }[];
      };
    }[];
  };
  errors?: { code: string; message: string }[];
}

export async function createFedExShipment(payload: FedExShipmentRequest): Promise<FedExShipmentResponse> {
  const base = getBase();
  const token = await getFedExToken();
  const accountNumber = process.env.FEDEX_ACCOUNT_NUMBER;
  if (!accountNumber) throw new Error('FEDEX_ACCOUNT_NUMBER not set');

  const body = {
    labelResponseOptions: 'LABEL',
    requestedShipment: payload,
    accountNumber: { value: accountNumber },
  };

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${base}/ship/v1/shipments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-locale': 'en_GB',
        },
        body: JSON.stringify(body),
      });

      let data: FedExShipmentResponse;
      try {
        const text = await res.text();
        if (!text.trim().startsWith('{')) {
          const err = new Error(`FedEx returned non-JSON response (${res.status}): ${text.slice(0, 200)}...`);
          if (attempt < maxRetries) {
            console.warn(`[FedEx] Transient non-JSON response, retrying: ${err.message}`);
            lastError = err;
            const delay = 1000 * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          throw err;
        }
        data = JSON.parse(text) as FedExShipmentResponse;
      } catch (parseErr) {
        const err = new Error(`FedEx API response parsing failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
        if (attempt < maxRetries) {
          console.warn(`[FedEx] Transient parsing error, retrying: ${err.message}`);
          lastError = err;
          const delay = 1000 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
      console.log(`[FedEx] create shipment attempt ${attempt + 1}: status=${res.status}, errors=${data.errors?.length ?? 0}`);

      if (!res.ok || data.errors?.length) {
        const detail = data.errors?.map((e) => e.message).join('; ') || res.statusText;
        // Retry on transient errors (503, 502, 429, or explicit "service is currently unavailable")
        const isTransient = res.status === 503 || res.status === 502 || res.status === 429 || /unavailable|unexpected error|working to resolve|rate limit|try again later|check back later/i.test(detail);
        if (isTransient && attempt < maxRetries) {
          console.warn(`[FedEx] Transient error, retrying: ${detail}`);
          lastError = new Error(`FedEx API error: ${detail}`);
          const delay = 1000 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`FedEx API error: ${detail}`);
      }

      return data;
    } catch (err) {
      if (attempt === maxRetries) {
        console.error('[FedEx] Max retries exceeded:', err);
        throw lastError || err;
      }
      // Network or parsing errors that aren't from the API response itself
      if (err instanceof Error && err.message.includes('FedEx API error:')) {
        throw err;
      }
      console.warn(`[FedEx] Network/parsing error on attempt ${attempt + 1}, retrying:`, err);
      lastError = err instanceof Error ? err : new Error(String(err));
      const delay = 1000 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('FedEx shipment creation failed after retries');
}

export interface FedExTrackingResponse {
  output?: {
    trackingResults?: {
      trackingNumberInfo?: {
        trackingNumber: string;
      };
      scanEvents?: {
        date: string;
        time: string;
        scanType: string;
        scanLocation?: string;
      }[];
    }[];
  };
  errors?: { code: string; message: string }[];
}

export async function trackFedExShipment(trackingNumber: string): Promise<FedExTrackingResponse> {
  const base = getBase();
  const token = await getFedExToken();

  const res = await fetch(`${base}/track/v1/trackingnumbers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-locale': 'en_GB',
    },
    body: JSON.stringify({
      includeDetailedScans: true,
      trackingInfo: [{
        trackingNumberInfo: {
          trackingNumber,
        }
      }]
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`FedEx tracking API error: ${res.status} ${body}`);
  }

  return res.json() as FedExTrackingResponse;
}
