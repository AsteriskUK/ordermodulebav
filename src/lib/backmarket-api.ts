import { Order } from './types';
import { deriveShipping } from './csv-parser';
import { deriveCategory } from './categoriser';

const DEFAULT_BASE_URL = 'https://www.backmarket.fr';

export interface BackmarketAddress {
  company?: string;
  // API returns camelCase
  firstName?: string;
  lastName?: string;
  // legacy snake_case fallbacks
  first_name?: string;
  last_name?: string;
  street?: string;
  street2?: string;
  postalCode?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  phoneNumber?: string;
  phone?: string;
  email?: string;
  state?: string;
  customer_id_number?: string;
}

export interface BackmarketListingSnapshot {
  id?: number;
  sku?: string;
  image?: string;
  listing?: number;
  title?: string;
  product?: {
    product_id?: number;
    title?: string;
    content?: string;
    category_3?: {
      category_name?: string;
    };
  };
}

export interface BackmarketOrderline {
  id?: number;
  quantity?: number;
  price?: string;
  shipping_price?: string;
  currency?: string;
  state?: number;
  return_reason?: number;
  return_message?: string;
  backcare?: boolean;
  backcare_price?: number;
  snapshot?: BackmarketListingSnapshot;
  /** SKU string e.g. 'IPHONE416GONLIB0' */
  listing?: string | number;
  /** Numeric listing ID */
  listing_id?: number;
  /** Item title — the real field name in the API response */
  product?: string;
  product_id?: number;
  brand?: string;
  condition?: number;
  imei?: string;
  serial_number?: string;
  /** Legacy / fallback title fields */
  title?: string;
  content?: string;
}

export interface BackmarketOrder {
  order_id: number;
  shipping_address?: BackmarketAddress;
  billing_address?: BackmarketAddress;
  tracking_number?: string;
  tracking_url?: string;
  shipper?: string;
  shipper_display?: string;
  date_creation?: string;
  date_modification?: string;
  date_shipping?: string;
  date_payment?: string;
  state?: number;
  price?: string;
  shipping_price?: string;
  currency?: string;
  country_code?: string;
  orderlines?: BackmarketOrderline[];
  // Some endpoints return a flat list of orderlines with the order embedded
  id?: number;
  order?: BackmarketOrder;
  snapshot?: BackmarketListingSnapshot;
  quantity?: number;
}

export interface BackmarketPagedResponse {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: BackmarketOrder[];
}

export function getBackmarketCredentials(): { username: string; password: string } | null {
  const username = process.env.BACKMARKET_USERNAME;
  const password = process.env.BACKMARKET_PASSWORD;
  if (!username || !password) return null;
  return { username, password };
}

export function getBackmarketApiToken(): string | null {
  return process.env.BACKMARKET_API_TOKEN || null;
}

export function getBackmarketBaseUrl(): string {
  return (process.env.BACKMARKET_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

export function isBackmarketConfigured(): boolean {
  return !!getBackmarketCredentials() || !!getBackmarketApiToken();
}

export function buildBackmarketAuthHeader(): string {
  const token = getBackmarketApiToken();
  if (token) {
    // Backmarket docs format: "Authorization: Basic YOUR_ACCESS_TOKEN"
    return token.startsWith('Basic ') || token.startsWith('Bearer ') ? token : `Basic ${token}`;
  }
  const creds = getBackmarketCredentials();
  if (!creds) throw new Error('Backmarket credentials not configured');
  return `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;
}

export function getBackmarketHeaders(): Record<string, string> {
  const countryCode = (process.env.BACKMARKET_COUNTRY_CODE || 'fr-fr').toLowerCase();
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Accept-Language': countryCode,
    'Authorization': buildBackmarketAuthHeader(),
    'User-Agent': process.env.BACKMARKET_USER_AGENT || 'BM-Company-OrdersIntegration;contact@company.com',
  };
}

export async function fetchBackmarketListingTitle(listingId: number): Promise<string | null> {
  const baseUrl = getBackmarketBaseUrl();
  const url = `${baseUrl}/ws/listings/${listingId}`;
  try {
    const res = await fetch(url, { headers: getBackmarketHeaders() });
    const rawBody = await res.text();
    if (!res.ok) {
      console.error(`[Backmarket listing] failed ${res.status}: ${rawBody.slice(0, 200)}`);
      return null;
    }
    const data = JSON.parse(rawBody) as { title?: string };
    return data.title || null;
  } catch (e) {
    console.error('[Backmarket listing] error:', e);
    return null;
  }
}

export function getBackmarketLineTitle(line: BackmarketOrderline): string {
  return line.product ||
    line.title ||
    line.content ||
    line.snapshot?.title ||
    line.snapshot?.product?.title ||
    line.snapshot?.product?.content ||
    line.snapshot?.product?.category_3?.category_name ||
    line.snapshot?.sku ||
    '';
}

function formatBackmarketDate(isoDate: string): string {
  // Backmarket expects YYYY-MM-DD HH:MM:SS, not ISO 8601
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function fetchBackmarketOrders(
  filters: {
    date_creation?: string;
    date_modification?: string;
    country_code?: string;
    state?: number;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<BackmarketPagedResponse> {
  const baseUrl = getBackmarketBaseUrl();
  const params = new URLSearchParams();
  if (filters.date_creation) params.set('date_creation', formatBackmarketDate(filters.date_creation));
  if (filters.date_modification) params.set('date_modification', formatBackmarketDate(filters.date_modification));
  if (filters.country_code) params.set('country_code', filters.country_code);
  if (filters.state !== undefined) params.set('state', String(filters.state));
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('page-size', String(filters.pageSize));

  const url = `${baseUrl}/ws/orders${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url, { headers: getBackmarketHeaders() });
  const rawBody = await res.text();
  if (!res.ok) {
    throw new Error(`Backmarket API error ${res.status}: ${rawBody.slice(0, 500)}`);
  }
  try {
    return JSON.parse(rawBody) as BackmarketPagedResponse;
  } catch {
    throw new Error(`Invalid JSON from Backmarket API: ${rawBody.slice(0, 500)}`);
  }
}

export interface BackmarketListingPayload {
  sku: string;
  listing: number;
  price: number;
  quantity: number;
  condition: number;
  description: string;
  currency?: string;
  new_battery?: boolean;
  min_price?: number;
}

export interface BackmarketListingResult {
  id?: number;
  sku?: string;
  listing?: number;
  price?: string;
  quantity?: number;
  condition?: number;
  description?: string;
}

export async function createBackmarketListing(
  payload: BackmarketListingPayload
): Promise<{ success: true; result: BackmarketListingResult } | { success: false; status: number; message: string }> {
  const baseUrl = getBackmarketBaseUrl();
  const url = `${baseUrl}/ws/listings`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getBackmarketHeaders(),
    body: JSON.stringify(payload),
  });
  const rawBody = await res.text();
  if (!res.ok) {
    return { success: false, status: res.status, message: rawBody.slice(0, 500) };
  }
  try {
    return { success: true, result: JSON.parse(rawBody) as BackmarketListingResult };
  } catch {
    return { success: true, result: {} };
  }
}

export async function mapBackmarketOrderToOrder(
  input: BackmarketOrder,
  batchId: string
): Promise<Order[]> {
  // Handle flat orderline responses where the orderline contains the order
  const order: BackmarketOrder = input.order ?? input;
  const orderline: BackmarketOrderline | undefined = input.order ? input : undefined;

  const orderlines = order.orderlines ?? (orderline ? [orderline] : []);
  if (orderlines.length === 0 && orderline) {
    orderlines.push(orderline);
  }

  const addr = order.shipping_address;
  const postToName = [
    addr?.firstName || addr?.first_name,
    addr?.lastName  || addr?.last_name,
  ].filter(Boolean).join(' ').trim();
  const postToPhone = addr?.phoneNumber || addr?.phone || '';
  const postToAddress1 = addr?.street || '';
  const postToAddress2 = addr?.street2 || '';
  const postToCity = addr?.city || '';
  const postToCounty = addr?.state || '';
  const postToPostcode = addr?.postalCode || addr?.postal_code || '';
  const postToCountry = addr?.country === 'GB' ? 'United Kingdom' : (addr?.country || '');
  const buyerEmail = addr?.email || order.billing_address?.email || '';
  const buyerName = postToName;

  const totalPrice = parseFloat(order.price || '0');
  const postageAndPackaging = parseFloat(order.shipping_price || '0');
  const saleDate = order.date_creation || '';
  const paidOnDate = order.date_payment || saleDate;

  const { deliveryCarrier, deliveryType } = deriveShipping(postToPostcode, totalPrice, postageAndPackaging);

  if (orderlines.length === 0) {
    // No orderlines available; create a single order from the order summary
    return [{
      id: `backmarket-${order.order_id}`,
      salesRecordNumber: String(order.order_id),
      orderNumber: String(order.order_id),
      buyerUsername: '',
      buyerName,
      buyerEmail,
      buyerNote: '',
      postToName,
      postToPhone,
      postToAddress1,
      postToAddress2,
      postToCity,
      postToCounty,
      postToPostcode,
      postToCountry,
      itemNumber: '',
      itemTitle: '',
      customLabel: '',
      variation: '',
      quantity: 1,
      soldFor: totalPrice,
      postageAndPackaging,
      totalPrice,
      priority: 5,
      numberOfBoxes: 1,
      saleDate,
      paidOnDate,
      postByDate: '',
      dispatchedOnDate: order.date_shipping || '',
      deliveryService: order.shipper_display || order.shipper || '',
      trackingNumber: order.tracking_number || '',
      deliveryCarrier,
      deliveryType,
      status: order.state === 9 ? 'shipped' : order.state === 4 || order.state === 8 ? 'cancelled' : 'pending',
      category: 'N/A',
      comments: '',
      labelQty: 1,
      isGSP: (addr?.country || 'GB') !== 'GB',
      extendedLiability: false,
      importedAt: new Date().toISOString(),
      batchId,
    }];
  }

  return Promise.all(orderlines.map(async (line, idx): Promise<Order> => {
    let itemTitle = getBackmarketLineTitle(line);
    // listing is a SKU string; listing_id is the numeric ID
    const sku = (typeof line.listing === 'string' ? line.listing : '') || line.snapshot?.sku || '';
    const listingId = line.listing_id || line.snapshot?.listing || (typeof line.listing === 'number' ? line.listing : undefined);
    if (!itemTitle && listingId) {
      const fetchedTitle = await fetchBackmarketListingTitle(listingId);
      if (fetchedTitle) itemTitle = fetchedTitle;
    }
    if (!itemTitle) {
      itemTitle = sku || 'Back Market item';
    }
    const quantity = line.quantity || 1;
    const itemPrice = parseFloat(line.price || '0');
    const itemTotal = itemPrice * quantity;
    const category = deriveCategory(itemTitle);

    return {
      id: `backmarket-${order.order_id}-${line.id || idx}`,
      salesRecordNumber: String(order.order_id),
      orderNumber: String(order.order_id),
      buyerUsername: '',
      buyerName,
      buyerEmail,
      buyerNote: '',
      postToName,
      postToPhone,
      postToAddress1,
      postToAddress2,
      postToCity,
      postToCounty,
      postToPostcode,
      postToCountry,
      itemNumber: String(line.listing_id || line.id || ''),
      itemTitle,
      customLabel: sku,
      variation: '',
      quantity,
      soldFor: itemTotal,
      postageAndPackaging: idx === 0 ? postageAndPackaging : 0,
      totalPrice: idx === 0 ? totalPrice : itemTotal,
      priority: 5,
      numberOfBoxes: 1,
      saleDate,
      paidOnDate,
      postByDate: '',
      dispatchedOnDate: order.date_shipping || '',
      deliveryService: order.shipper_display || order.shipper || '',
      trackingNumber: order.tracking_number || '',
      deliveryCarrier,
      deliveryType,
      status: order.state === 9 ? 'shipped' : order.state === 4 || order.state === 8 ? 'cancelled' : 'pending',
      category,
      comments: '',
      labelQty: 1,
      isGSP: (addr?.country || 'GB') !== 'GB',
      extendedLiability: false,
      importedAt: new Date().toISOString(),
      batchId,
    };
  }));
}
