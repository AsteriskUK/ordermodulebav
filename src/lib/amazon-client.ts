import { Order } from './types';
import { deriveShipping } from './csv-parser';
import { deriveCategory } from './categoriser';
import { stableUuid } from './utils';

// Amazon Selling Partner API (SP-API) client for order sync.
//
// Modern SP-API auth is LWA-only: exchange the refresh token for an access token
// and send it as `x-amz-access-token`. The old AWS SigV4/IAM-role signing was
// dropped by Amazon, so no AWS credentials are needed here.
//
// Buyer name + shipping address are restricted PII. Rather than a separate
// getOrder/address/buyerInfo call per order, we mint a Restricted Data Token
// (RDT) scoped to the getOrders collection and reuse it for the whole sync — so
// the list response carries ShippingAddress + BuyerInfo inline.
//
// Env:
//   AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET, AMAZON_REFRESH_TOKEN
//   AMAZON_MARKETPLACE_ID   (default A1F83G8C2ARO7P = Amazon UK)
//   AMAZON_SPAPI_ENDPOINT   (default https://sellingpartnerapi-eu.amazon.com)

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const DEFAULT_ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com';
const DEFAULT_MARKETPLACE = 'A1F83G8C2ARO7P'; // Amazon.co.uk

// ─── Credentials ─────────────────────────────────────────────────────────────

export interface AmazonCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  marketplaceId: string;
  endpoint: string;
}

export function getAmazonCredentials(): AmazonCredentials | null {
  const clientId = process.env.AMAZON_LWA_CLIENT_ID;
  const clientSecret = process.env.AMAZON_LWA_CLIENT_SECRET;
  const refreshToken = process.env.AMAZON_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    marketplaceId: process.env.AMAZON_MARKETPLACE_ID || DEFAULT_MARKETPLACE,
    // Trim trailing slashes/dots so a stray "…amazon.com." or "…/" doesn't break requests.
    endpoint: (process.env.AMAZON_SPAPI_ENDPOINT || DEFAULT_ENDPOINT).trim().replace(/[/.]+$/, ''),
  };
}

export function isAmazonConfigured(): boolean {
  return !!getAmazonCredentials();
}

// ─── Auth ────────────────────────────────────────────────────────────────────
// LWA access tokens last 1 hour; cache per warm instance and refresh a minute early.

let _token: { token: string; expiresAt: number } | null = null;

export async function getAmazonAccessToken(): Promise<string> {
  const creds = getAmazonCredentials();
  if (!creds) throw new Error('Amazon SP-API credentials not configured');
  if (_token && Date.now() < _token.expiresAt - 60_000) return _token.token;

  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    // LWA errors are JSON { error, error_description }; surface those over the
    // raw body so the failure reason (invalid_client vs invalid_grant) is clear.
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { error?: string; error_description?: string };
      detail = [j.error, j.error_description].filter(Boolean).join(': ') || detail;
    } catch { /* keep raw */ }
    throw new Error(`Amazon LWA auth failed ${res.status}: ${detail}`);
  }

  const data = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error(`Amazon LWA returned no token: ${text.slice(0, 200)}`);
  _token = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

// A Restricted Data Token scoped to the getOrders collection, so the list
// response includes buyer name + shipping address. RDTs are short-lived; we mint
// one per sync and pass it back to the caller.
export async function createOrdersRdt(): Promise<string> {
  const creds = getAmazonCredentials()!;
  const accessToken = await getAmazonAccessToken();
  const res = await fetch(`${creds.endpoint}/tokens/2021-03-01/restrictedDataToken`, {
    method: 'POST',
    headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      restrictedResources: [
        { method: 'GET', path: '/orders/v0/orders', dataElements: ['buyerInfo', 'shippingAddress'] },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Amazon RDT request failed ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { restrictedDataToken?: string };
  if (!data.restrictedDataToken) throw new Error('Amazon RDT response had no token');
  return data.restrictedDataToken;
}

async function spGet<T>(path: string, params: Record<string, string>, token: string, endpoint: string): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${endpoint}${path}${qs ? `?${qs}` : ''}`;
  // SP-API returns 429 when throttled; retry a few times with backoff.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'x-amz-access-token': token } });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Amazon GET ${path} failed ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }
  throw new Error(`Amazon GET ${path} throttled after retries`);
}

// ─── Types (subset of SP-API Orders v0) ──────────────────────────────────────

export interface AmazonMoney { CurrencyCode?: string; Amount?: string }

export interface AmazonAddress {
  Name?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  AddressLine3?: string;
  City?: string;
  County?: string;
  StateOrRegion?: string;
  PostalCode?: string;
  CountryCode?: string;
  Phone?: string;
}

export interface AmazonOrder {
  AmazonOrderId: string;
  PurchaseDate?: string;
  LastUpdateDate?: string;
  OrderStatus?: string;
  OrderTotal?: AmazonMoney;
  ShipmentServiceLevelCategory?: string;
  ShippingAddress?: AmazonAddress;
  BuyerInfo?: { BuyerEmail?: string; BuyerName?: string };
  MarketplaceId?: string;
  NumberOfItemsShipped?: number;
  NumberOfItemsUnshipped?: number;
}

export interface AmazonOrderItem {
  ASIN?: string;
  SellerSKU?: string;
  OrderItemId?: string;
  Title?: string;
  QuantityOrdered?: number;
  ItemPrice?: AmazonMoney;
  ShippingPrice?: AmazonMoney;
}

interface OrdersPayload { Orders?: AmazonOrder[]; NextToken?: string }
interface OrderItemsPayload { OrderItems?: AmazonOrderItem[]; NextToken?: string }

// ─── API calls ───────────────────────────────────────────────────────────────

export async function fetchAmazonOrders(opts: {
  createdAfter: string;   // ISO 8601
  nextToken?: string;
  token: string;          // an RDT (returns buyer/address inline) or a plain LWA access token
}): Promise<OrdersPayload> {
  const creds = getAmazonCredentials()!;
  const params: Record<string, string> = opts.nextToken
    ? { NextToken: opts.nextToken, MarketplaceIds: creds.marketplaceId }
    : { MarketplaceIds: creds.marketplaceId, CreatedAfter: opts.createdAfter };
  const data = await spGet<{ payload?: OrdersPayload }>('/orders/v0/orders', params, opts.token, creds.endpoint);
  return data.payload ?? {};
}

export async function fetchAmazonOrderItems(orderId: string): Promise<AmazonOrderItem[]> {
  const creds = getAmazonCredentials()!;
  const token = await getAmazonAccessToken();
  const items: AmazonOrderItem[] = [];
  let nextToken: string | undefined;
  do {
    const params: Record<string, string> = nextToken ? { NextToken: nextToken } : {};
    const data = await spGet<{ payload?: OrderItemsPayload }>(`/orders/v0/orders/${orderId}/orderItems`, params, token, creds.endpoint);
    items.push(...(data.payload?.OrderItems ?? []));
    nextToken = data.payload?.NextToken;
  } while (nextToken);
  return items;
}

// ─── Messaging ───────────────────────────────────────────────────────────────
// SP-API Messaging v1. Amazon has no buyer-message inbox API — sellers can only
// *send*, and only the templated message types Amazon permits for a given order
// (returned by getMessagingActions). Requires the "Messaging" role on the app.

// Actions whose request body carries free text. The rest are attachment-only
// (legalDisclosure, sendInvoice, sendAmazonMotors, warranty) or body-less
// (negativeFeedbackRemoval).
export const AMAZON_TEXT_ACTIONS = new Set([
  'confirmCustomizationDetails',
  'confirmDeliveryDetails',
  'confirmOrderDetails',
  'confirmServiceDetails',
  'digitalAccessKey',
  'unexpectedProblem',
]);

/** Message types Amazon currently allows for this order (may be empty). */
export async function getAmazonMessagingActions(amazonOrderId: string): Promise<string[]> {
  const creds = getAmazonCredentials()!;
  const token = await getAmazonAccessToken();
  const data = await spGet<{ _links?: { actions?: { name?: string }[] } }>(
    `/messaging/v1/orders/${encodeURIComponent(amazonOrderId)}`,
    { marketplaceIds: creds.marketplaceId },
    token,
    creds.endpoint,
  );
  return (data._links?.actions ?? [])
    .map((a) => a.name)
    .filter((n): n is string => !!n);
}

export async function sendAmazonMessage(amazonOrderId: string, action: string, text?: string): Promise<void> {
  const creds = getAmazonCredentials()!;
  const token = await getAmazonAccessToken();
  const url = `${creds.endpoint}/messaging/v1/orders/${encodeURIComponent(amazonOrderId)}/messages/${encodeURIComponent(action)}?marketplaceIds=${creds.marketplaceId}`;
  const body = AMAZON_TEXT_ACTIONS.has(action) ? JSON.stringify({ text }) : JSON.stringify({});

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
      body,
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Amazon send ${action} failed ${res.status}: ${errText.slice(0, 300)}`);
    }
    return;
  }
  throw new Error(`Amazon send ${action} throttled after retries`);
}

// ─── Mapper ──────────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toISO(d?: string): string {
  if (!d) return '';
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function mapAmazonStatus(o: AmazonOrder): Order['status'] {
  const s = (o.OrderStatus || '').toLowerCase();
  if (s === 'canceled' || s === 'cancelled' || s === 'unfulfillable') return 'cancelled';
  if (s === 'shipped') return 'shipped';
  return 'pending'; // Pending, Unshipped, PartiallyShipped, PendingAvailability, InvoiceUnconfirmed
}

/** Map one Amazon order + its items to internal Orders — one per item line, mirroring eBay/OnBuy/Temu. */
export function mapAmazonOrderToOrders(o: AmazonOrder, items: AmazonOrderItem[], batchId: string): Order[] {
  const addr = o.ShippingAddress || {};
  const saleDate = toISO(o.PurchaseDate) || new Date().toISOString();
  const countryCode = (addr.CountryCode || '').toUpperCase();
  const postToCountry = countryCode === 'GB' ? 'United Kingdom' : (addr.CountryCode || '');
  const isIntl = countryCode !== '' && countryCode !== 'GB';

  const base = {
    salesRecordNumber: o.AmazonOrderId,
    orderNumber: o.AmazonOrderId,
    amazonOrderId: o.AmazonOrderId,
    buyerUsername: '',
    buyerName: o.BuyerInfo?.BuyerName || addr.Name || '',
    buyerNote: '',
    postToName: addr.Name || o.BuyerInfo?.BuyerName || '',
    postToPhone: addr.Phone || '',
    postToAddress1: addr.AddressLine1 || '',
    postToAddress2: [addr.AddressLine2, addr.AddressLine3].filter(Boolean).join(', '),
    postToCity: addr.City || '',
    postToCounty: addr.County || addr.StateOrRegion || '',
    postToPostcode: (addr.PostalCode || '').toUpperCase(),
    postToCountry,
    buyerEmail: o.BuyerInfo?.BuyerEmail || '',
    priority: 5,
    numberOfBoxes: 1,
    saleDate,
    paidOnDate: saleDate,
    postByDate: '',
    dispatchedOnDate: '',
    trackingNumber: '',
    status: mapAmazonStatus(o),
    comments: '',
    labelQty: 1,
    isGSP: isIntl,
    extendedLiability: false,
    importedAt: new Date().toISOString(),
    batchId,
  };

  // Fall back to a single line from the order total when items are unavailable.
  if (items.length === 0) {
    const total = num(o.OrderTotal?.Amount);
    const { deliveryCarrier, deliveryType } = deriveShipping(base.postToPostcode, total, 0);
    return [{
      ...base,
      id: stableUuid(`amazon-${o.AmazonOrderId}`),
      itemNumber: '',
      itemTitle: '',
      customLabel: '',
      variation: '',
      quantity: 1,
      soldFor: total,
      postageAndPackaging: 0,
      totalPrice: total,
      deliveryService: o.ShipmentServiceLevelCategory || '',
      deliveryCarrier,
      deliveryType,
      category: 'N/A',
    }];
  }

  return items.map((it, idx): Order => {
    const itemTitle = it.Title || '';
    const quantity = num(it.QuantityOrdered) || 1;
    const sold = num(it.ItemPrice?.Amount);
    const pp = num(it.ShippingPrice?.Amount);
    const total = sold + pp;
    const { deliveryCarrier, deliveryType } = deriveShipping(base.postToPostcode, total, pp);
    return {
      ...base,
      id: stableUuid(`amazon-${o.AmazonOrderId}-${it.OrderItemId || it.SellerSKU || idx}`),
      itemNumber: it.ASIN || '',
      itemTitle,
      customLabel: it.SellerSKU || '',
      variation: '',
      quantity,
      soldFor: sold,
      postageAndPackaging: pp,
      totalPrice: total,
      deliveryService: o.ShipmentServiceLevelCategory || '',
      deliveryCarrier,
      deliveryType,
      category: deriveCategory(itemTitle),
    };
  });
}
