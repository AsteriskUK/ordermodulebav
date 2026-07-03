import { Order } from './types';
import { deriveShipping } from './csv-parser';
import { deriveCategory } from './categoriser';

const ONBUY_API = 'https://api.onbuy.com/v2';

// ─── Credentials ─────────────────────────────────────────────────────────────

export function getOnBuyCredentials(): { consumerKey: string; secretKey: string; siteId: number } | null {
  const consumerKey = process.env.ONBUY_CONSUMER_KEY;
  const secretKey = process.env.ONBUY_SECRET_KEY;
  if (!consumerKey || !secretKey) return null;
  const siteId = Number(process.env.ONBUY_SITE_ID) || 2000;
  return { consumerKey, secretKey, siteId };
}

export function isOnBuyConfigured(): boolean {
  return !!getOnBuyCredentials();
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
// OnBuy tokens are minted from the consumer/secret keys, last 15 minutes, and are
// locked to the requesting IP. Cache the token per warm server instance and
// refresh a minute early. One token covers all pages of a single import.

let _token: { token: string; expiresAt: number } | null = null;

export async function getOnBuyToken(): Promise<string> {
  const creds = getOnBuyCredentials();
  if (!creds) throw new Error('OnBuy credentials not configured');
  if (_token && Date.now() < _token.expiresAt - 60_000) return _token.token;

  const res = await fetch(`${ONBUY_API}/auth/request-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret_key: creds.secretKey, consumer_key: creds.consumerKey }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OnBuy auth failed ${res.status}: ${text.slice(0, 300)}`);

  const data = JSON.parse(text) as { access_token?: string; expires_at?: number };
  if (!data.access_token) throw new Error(`OnBuy auth returned no token: ${text.slice(0, 200)}`);

  // expires_at is a unix-seconds timestamp; guard against a stale/past value.
  const expiresAt = data.expires_at && data.expires_at * 1000 > Date.now()
    ? data.expires_at * 1000
    : Date.now() + 15 * 60_000;
  _token = { token: data.access_token, expiresAt };
  return data.access_token;
}

async function onbuyGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const token = await getOnBuyToken();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const res = await fetch(`${ONBUY_API}${path}?${qs.toString()}`, {
    headers: { Authorization: token },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OnBuy GET ${path} failed ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnBuyAddress {
  name?: string;
  line_1?: string;
  line_2?: string;
  line_3?: string;
  town?: string;
  county?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

export interface OnBuyBuyer {
  name?: string;
  email?: string;
  phone?: string;
  ip_address?: string;
}

export interface OnBuyProduct {
  onbuy_internal_reference?: string | number;
  name?: string;
  sku?: string;
  condition?: string;
  quantity?: string | number;
  quantity_dispatched?: string | number;
  unit_price?: string | number;
  total_price?: string | number;
  price_delivery_total?: string | number;
  expected_dispatch_date?: string;
  expected_delivery_date?: string;
  opc?: string;
  image_urls?: { thumb?: string; small?: string; original?: string; large?: string };
}

export interface OnBuyOrder {
  order_id: string;
  onbuy_internal_reference?: string;
  date?: string;
  updated_at?: string;
  cancelled_at?: string | null;
  shipped_at?: string | null;
  status?: string;
  site_id?: string;
  site_name?: string;
  price_subtotal?: string;
  price_delivery?: string;
  price_total?: string;
  price_discount?: string;
  currency_code?: string;
  dispatched?: boolean;
  delivery_service?: string;
  buyer?: OnBuyBuyer;
  billing_address?: OnBuyAddress;
  delivery_address?: OnBuyAddress;
  products?: OnBuyProduct[];
}

export interface OnBuyOrdersResponse {
  results: OnBuyOrder[];
  metadata?: { limit: number; offset: number; total_rows: number; filters?: Record<string, unknown> };
}

// ─── API calls ──────────────────────────────────────────────────────────────────

export async function fetchOnBuyOrders(params: {
  siteId: number;
  limit?: number;
  offset?: number;
  status?: string;              // 'all' or a specific OnBuy status
  modifiedSince?: string;       // "YYYY-MM-DD HH:MM:SS"
  sortCreated?: 'asc' | 'desc';
  previouslyExported?: 0 | 1;
}): Promise<OnBuyOrdersResponse> {
  const q: Record<string, string | number> = {
    site_id: params.siteId,
    'filter[status]': params.status ?? 'all',
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
    'sort[created]': params.sortCreated ?? 'desc',
  };
  if (params.modifiedSince) q['filter[modified_since]'] = params.modifiedSince;
  if (params.previouslyExported != null) q['previously_exported'] = params.previouslyExported;
  return onbuyGet<OnBuyOrdersResponse>('/orders', q);
}

// ─── Mapper ──────────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// OnBuy timestamps are "YYYY-MM-DD HH:MM:SS"; normalise to ISO.
function toISO(d?: string | null): string {
  if (!d) return '';
  const parsed = new Date(d.includes('T') ? d : d.replace(' ', 'T'));
  return isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function mapOnBuyStatus(o: OnBuyOrder): Order['status'] {
  const s = (o.status || '').toLowerCase();
  if (o.cancelled_at || s.includes('cancel')) return 'cancelled';
  if (s.includes('refund')) return 'refunded';
  if (s.includes('complete') || s.includes('delivered')) return 'delivered';
  if (o.dispatched || o.shipped_at || s.includes('dispatched') || s.includes('shipped')) return 'shipped';
  return 'pending'; // e.g. "Awaiting Dispatch"
}

/** Map one OnBuy order to internal Orders — one per product line, mirroring eBay/Temu. */
export function mapOnBuyOrderToOrders(o: OnBuyOrder, batchId: string): Order[] {
  const addr = o.delivery_address || o.billing_address || {};
  const saleDate = toISO(o.date) || new Date().toISOString();
  const postToCountry = addr.country || '';
  const isIntl = postToCountry !== '' && postToCountry !== 'United Kingdom' && addr.country_code !== 'GB';
  const { deliveryCarrier, deliveryType } = deriveShipping(addr.postcode || '', num(o.price_total), num(o.price_delivery));

  const base = {
    salesRecordNumber: o.order_id,
    orderNumber: o.order_id,
    buyerUsername: '',
    buyerName: o.buyer?.name || addr.name || '',
    buyerNote: '',
    postToName: addr.name || o.buyer?.name || '',
    postToPhone: o.buyer?.phone || '',
    postToAddress1: addr.line_1 || '',
    postToAddress2: [addr.line_2, addr.line_3].filter(Boolean).join(', '),
    postToCity: addr.town || '',
    postToCounty: addr.county || '',
    postToPostcode: (addr.postcode || '').toUpperCase(),
    postToCountry,
    buyerEmail: o.buyer?.email || '',
    priority: 5,
    numberOfBoxes: 1,
    saleDate,
    paidOnDate: saleDate,
    postByDate: '',
    dispatchedOnDate: toISO(o.shipped_at),
    deliveryService: o.delivery_service || '',
    trackingNumber: '',
    deliveryCarrier,
    deliveryType,
    status: mapOnBuyStatus(o),
    comments: '',
    labelQty: 1,
    isGSP: isIntl,
    extendedLiability: false,
    importedAt: new Date().toISOString(),
    batchId,
  };

  const products = o.products ?? [];
  if (products.length === 0) {
    return [{
      ...base,
      id: `onbuy-${o.order_id}`,
      itemNumber: o.onbuy_internal_reference || '',
      itemTitle: '',
      customLabel: '',
      variation: '',
      quantity: 1,
      soldFor: num(o.price_subtotal),
      postageAndPackaging: num(o.price_delivery),
      totalPrice: num(o.price_total),
      category: 'N/A',
    }];
  }

  return products.map((p, idx): Order => {
    const itemTitle = p.name || '';
    const quantity = num(p.quantity) || 1;
    const lineItems = num(p.total_price) || num(p.unit_price) * quantity;
    // Delivery is charged once per order — attribute it to the first line only.
    const delivery = idx === 0 ? num(o.price_delivery) : 0;
    return {
      ...base,
      id: `onbuy-${o.order_id}-${p.onbuy_internal_reference || p.sku || idx}`,
      itemNumber: String(p.onbuy_internal_reference || ''),
      itemTitle,
      customLabel: p.sku || '',
      variation: p.condition && p.condition.toLowerCase() !== 'new' ? p.condition : '',
      quantity,
      soldFor: lineItems,
      postageAndPackaging: delivery,
      totalPrice: lineItems + delivery,
      postByDate: toISO(p.expected_dispatch_date),
      category: deriveCategory(itemTitle),
    };
  });
}
