import { gunzipSync } from 'zlib';
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

/** A single order's current state — used to skip confirming an already-shipped order. */
export async function getAmazonOrder(orderId: string): Promise<AmazonOrder | null> {
  const creds = getAmazonCredentials()!;
  const token = await getAmazonAccessToken();
  const data = await spGet<{ payload?: AmazonOrder }>(`/orders/v0/orders/${orderId}`, {}, token, creds.endpoint);
  return data.payload ?? null;
}

// Amazon accepts a fixed set of carrier codes; anything outside it must be sent as
// a free-text carrierName instead (or the confirmation is rejected). DPD isn't in
// the enum, so it goes through as a name; FedEx has a recognised code.
function amazonCarrierField(carrier?: string): { carrierCode: string } | { carrierName: string } {
  const c = (carrier || '').trim();
  const KNOWN: Record<string, string> = { fedex: 'FedEx', ups: 'UPS', usps: 'USPS', dhl: 'DHL' };
  const code = KNOWN[c.toLowerCase()];
  return code ? { carrierCode: code } : { carrierName: c || 'Other' };
}

/**
 * Confirm shipment of an Amazon (MFN) order — the Amazon equivalent of uploading
 * tracking to eBay. Marks the order dispatched for the buyer with the carrier's
 * tracking number. Returns { alreadyShipped } when Amazon already has it shipped.
 */
export async function confirmAmazonShipment(
  orderId: string,
  opts: { trackingNumber: string; carrier?: string; shipDate?: string },
): Promise<{ shipped: true; alreadyShipped?: boolean }> {
  const creds = getAmazonCredentials()!;
  const token = await getAmazonAccessToken();

  // Idempotent: if Amazon already shows the order shipped, don't confirm again.
  const order = await getAmazonOrder(orderId);
  if (order?.OrderStatus === 'Shipped') return { shipped: true, alreadyShipped: true };

  const items = await fetchAmazonOrderItems(orderId);
  const orderItems = items
    .filter((it) => it.OrderItemId)
    .map((it) => ({ orderItemId: it.OrderItemId!, quantity: num(it.QuantityOrdered) || 1 }));

  const body = {
    marketplaceId: creds.marketplaceId,
    packageDetail: {
      packageReferenceId: '1',
      ...amazonCarrierField(opts.carrier),
      trackingNumber: opts.trackingNumber,
      shipDate: opts.shipDate || new Date().toISOString(),
      ...(orderItems.length ? { orderItems } : {}),
    },
  };

  // confirmShipment returns 204 No Content on success (spPost tolerates an empty body).
  await spPost(`/orders/v0/orders/${orderId}/shipmentConfirmation`, body, token, creds.endpoint);
  return { shipped: true };
}

// ─── Returns (Reports API) ────────────────────────────────────────────────────
// Amazon has no live returns endpoint for merchant-fulfilled (MFN) orders like
// eBay's Post-Order API. Returns come via the Reports API: request a report, poll
// until it's DONE, then download the (optionally GZIP'd) flat-file document. The
// request is rate-limited to ~1/min, so the route caches the reportId and resumes
// polling on the next call rather than requesting a fresh report each time.

const REPORTS_BASE = '/reports/2021-06-30';
// Merchant-fulfilled returns by return date (tab-separated flat file).
export const MFN_RETURNS_REPORT_TYPE = 'GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE';

async function spPost<T>(path: string, body: unknown, token: string, endpoint: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Amazon POST ${path} failed ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
  throw new Error(`Amazon POST ${path} throttled after retries`);
}

/** Ask Amazon to generate an MFN returns report. Returns the reportId to poll. */
export async function requestReturnsReport(daysBack: number): Promise<string> {
  const creds = getAmazonCredentials()!;
  const token = await getAmazonAccessToken();
  // SP-API rejects an end time within the last ~2 minutes.
  const dataEndTime = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const dataStartTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const data = await spPost<{ reportId?: string }>(
    `${REPORTS_BASE}/reports`,
    { reportType: MFN_RETURNS_REPORT_TYPE, marketplaceIds: [creds.marketplaceId], dataStartTime, dataEndTime },
    token,
    creds.endpoint,
  );
  if (!data.reportId) throw new Error('Amazon report request returned no reportId');
  return data.reportId;
}

export interface AmazonReportStatus {
  processingStatus: string;          // IN_QUEUE | IN_PROGRESS | DONE | CANCELLED | FATAL
  reportDocumentId?: string;
}

export async function getReportStatus(reportId: string): Promise<AmazonReportStatus> {
  const creds = getAmazonCredentials()!;
  const token = await getAmazonAccessToken();
  return spGet<AmazonReportStatus>(`${REPORTS_BASE}/reports/${reportId}`, {}, token, creds.endpoint);
}

/** Download a completed report document and return its decompressed text. */
export async function getReportDocumentText(reportDocumentId: string): Promise<string> {
  const creds = getAmazonCredentials()!;
  const token = await getAmazonAccessToken();
  const doc = await spGet<{ url?: string; compressionAlgorithm?: string }>(
    `${REPORTS_BASE}/documents/${reportDocumentId}`,
    {},
    token,
    creds.endpoint,
  );
  if (!doc.url) throw new Error('Amazon report document had no download URL');
  const res = await fetch(doc.url); // pre-signed S3 URL — no auth header
  if (!res.ok) throw new Error(`Amazon report document download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const raw = doc.compressionAlgorithm === 'GZIP' ? gunzipSync(buf) : buf;
  // EU flat-file reports are usually Windows-1252, not UTF-8. Decode as strict
  // UTF-8 first and fall back to windows-1252 if that fails, so accented item
  // names / dashes don't come back as replacement characters.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder('windows-1252').decode(raw);
  }
}

export interface AmazonReturn {
  orderId: string;
  rmaId?: string;
  asin?: string;
  sku?: string;
  itemName?: string;
  reason?: string;
  status?: string;
  quantity?: number;
  returnDate?: string;
}

/**
 * Parse the MFN returns flat file. Columns vary by marketplace, so we key off the
 * header names (normalised) rather than fixed positions.
 */
export function parseReturnsReport(tsv: string): AmazonReturn[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const header = lines[0].split('\t').map(norm);
  const idx = (name: string) => header.indexOf(name);
  const col = {
    orderId: idx('order id'),
    rmaId: idx('amazon rma id') !== -1 ? idx('amazon rma id') : idx('merchant rma id'),
    asin: idx('asin'),
    sku: idx('merchant sku') !== -1 ? idx('merchant sku') : idx('sku'),
    itemName: idx('item name'),
    reason: idx('return reason'),
    status: idx('return request status'),
    quantity: idx('return quantity'),
    returnDate: idx('return request date'),
  };
  const cell = (parts: string[], i: number) => (i >= 0 && i < parts.length ? parts[i].trim() : '');
  const out: AmazonReturn[] = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split('\t');
    const orderId = cell(p, col.orderId);
    if (!orderId) continue;
    const qty = parseInt(cell(p, col.quantity), 10);
    out.push({
      orderId,
      rmaId: cell(p, col.rmaId) || undefined,
      asin: cell(p, col.asin) || undefined,
      sku: cell(p, col.sku) || undefined,
      itemName: cell(p, col.itemName) || undefined,
      reason: cell(p, col.reason) || undefined,
      status: cell(p, col.status) || undefined,
      quantity: Number.isNaN(qty) ? undefined : qty,
      returnDate: cell(p, col.returnDate) || undefined,
    });
  }
  return out;
}

// ─── Ad spend (Settlement report) ─────────────────────────────────────────────
// PPC spend isn't in SP-API's order/finance data (that needs the separate
// Advertising API). The closest SP-API source is the settlement report, where ad
// spend appears as "Cost of Advertising" lines. Settlement reports are generated
// by Amazon automatically per disbursement (~2 weeks) and can only be listed,
// not requested — so this is a lagging per-settlement total, not a daily figure.

const SETTLEMENT_REPORT_TYPE = 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE';

export interface AmazonSettlementAdSpend {
  adSpend: number;          // total advertising cost in the settlement, positive
  currency: string;
  periodStart?: string;     // raw settlement-start-date from the report
  periodEnd?: string;
  settlementId?: string;
}

export async function fetchLatestSettlementAdSpend(): Promise<AmazonSettlementAdSpend | null> {
  const creds = getAmazonCredentials()!;
  const token = await getAmazonAccessToken();

  // Newest settlement reports first; take the most recent completed one.
  const list = await spGet<{ reports?: { reportId?: string; processingStatus?: string; reportDocumentId?: string }[] }>(
    `${REPORTS_BASE}/reports`,
    { reportTypes: SETTLEMENT_REPORT_TYPE, pageSize: '10' },
    token,
    creds.endpoint,
  );
  const done = (list.reports ?? []).find((r) => r.processingStatus === 'DONE' && r.reportDocumentId);
  if (!done?.reportDocumentId) return null;

  const text = await getReportDocumentText(done.reportDocumentId);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  // The settlement flat file is a wide, fixed schema (no single "amount" column).
  // Advertising charges land on rows where item-related-fee-type = "Cost of
  // Advertising" (amount in item-related-fee-amount), and occasionally in the
  // other-fee columns. Key by header name so column shifts don't break us.
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const header = lines[0].split('\t').map(norm);
  const idx = (name: string) => header.indexOf(name);
  const col = {
    itemFeeType: idx('item related fee type'),
    itemFeeAmount: idx('item related fee amount'),
    otherFeeReason: idx('other fee reason description'),
    otherFeeAmount: idx('other fee amount'),
    currency: idx('currency'),
    settlementId: idx('settlement id'),
    periodStart: idx('settlement start date'),
    periodEnd: idx('settlement end date'),
  };
  if (col.itemFeeAmount === -1 && col.otherFeeAmount === -1) return null;

  const cell = (parts: string[], i: number) => (i >= 0 && i < parts.length ? parts[i].trim() : '');
  let adSpend = 0;
  let currency = 'GBP';
  let periodStart: string | undefined, periodEnd: string | undefined, settlementId: string | undefined;
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split('\t');
    // The summary row (first data row) carries the settlement period + currency.
    if (!periodStart && cell(p, col.periodStart)) {
      periodStart = cell(p, col.periodStart);
      periodEnd = cell(p, col.periodEnd) || undefined;
      settlementId = cell(p, col.settlementId) || undefined;
    }
    if (!currency && cell(p, col.currency)) currency = cell(p, col.currency);
    // Ad cost is negative in the report (a charge).
    if (/advertis/i.test(cell(p, col.itemFeeType))) {
      const v = parseFloat(cell(p, col.itemFeeAmount));
      if (!Number.isNaN(v)) adSpend += v;
    }
    if (/advertis/i.test(cell(p, col.otherFeeReason))) {
      const v = parseFloat(cell(p, col.otherFeeAmount));
      if (!Number.isNaN(v)) adSpend += v;
    }
  }
  return {
    adSpend: Math.abs(Math.round(adSpend * 100) / 100),
    currency: currency || 'GBP',
    periodStart,
    periodEnd,
    settlementId,
  };
}

// ─── Finances (fees, refunds, net) ────────────────────────────────────────────
// SP-API Finances v0. financialEvents are keyed by *posted* date (when the money
// moved), analogous to eBay's transactionDate. We aggregate the day's shipment and
// refund events into gross / fees / refunds / net for the Overview. Requires the
// "Finance and Accounting" SP-API role; degrades gracefully if not granted.
// Note: this does NOT include advertising (PPC) spend — that lives in the separate
// Amazon Advertising API, or as "Cost of Advertising" lines in the Settlement report.

interface FinMoney { CurrencyAmount?: number; CurrencyCode?: string }
interface FinCharge { ChargeType?: string; ChargeAmount?: FinMoney }
interface FinFee { FeeType?: string; FeeAmount?: FinMoney }
interface FinPromo { PromotionAmount?: FinMoney }
interface FinShipmentItem { ItemChargeList?: FinCharge[]; ItemFeeList?: FinFee[]; PromotionList?: FinPromo[] }
interface FinShipmentEvent { AmazonOrderId?: string; ShipmentItemList?: FinShipmentItem[] }
interface FinRefundItem { ItemChargeAdjustmentList?: FinCharge[]; ItemFeeAdjustmentList?: FinFee[] }
interface FinRefundEvent { AmazonOrderId?: string; ShipmentItemAdjustmentList?: FinRefundItem[] }
interface FinancialEvents { ShipmentEventList?: FinShipmentEvent[]; RefundEventList?: FinRefundEvent[] }

export interface AmazonFinanceSummary {
  gross: number;       // sum of Principal item charges
  fees: number;        // total selling fees (referral/FBA/etc.), positive
  refunds: number;     // refunded principal, positive
  promotions: number;  // seller-funded promotions, positive
  net: number;         // gross − fees − refunds − promotions
  currency: string;
  orderCount: number;
}

export async function fetchAmazonFinanceSummary(postedAfter: string, postedBefore: string): Promise<AmazonFinanceSummary> {
  const creds = getAmazonCredentials()!;
  const token = await getAmazonAccessToken();
  let gross = 0, fees = 0, refunds = 0, promotions = 0;
  let currency = 'GBP';
  const orders = new Set<string>();
  let nextToken: string | undefined;

  for (let page = 0; page < 20; page++) {
    const params: Record<string, string> = nextToken
      ? { NextToken: nextToken }
      : { PostedAfter: postedAfter, PostedBefore: postedBefore, MaxResultsPerPage: '100' };
    const data = await spGet<{ payload?: { FinancialEvents?: FinancialEvents; NextToken?: string } }>(
      '/finances/v0/financialEvents', params, token, creds.endpoint,
    );
    const ev = data.payload?.FinancialEvents ?? {};
    for (const se of ev.ShipmentEventList ?? []) {
      if (se.AmazonOrderId) orders.add(se.AmazonOrderId);
      for (const it of se.ShipmentItemList ?? []) {
        for (const c of it.ItemChargeList ?? []) {
          if (c.ChargeType === 'Principal') gross += c.ChargeAmount?.CurrencyAmount ?? 0;
          if (c.ChargeAmount?.CurrencyCode) currency = c.ChargeAmount.CurrencyCode;
        }
        for (const f of it.ItemFeeList ?? []) fees += f.FeeAmount?.CurrencyAmount ?? 0;          // negative
        for (const p of it.PromotionList ?? []) promotions += p.PromotionAmount?.CurrencyAmount ?? 0; // negative
      }
    }
    for (const re of ev.RefundEventList ?? []) {
      for (const it of re.ShipmentItemAdjustmentList ?? []) {
        for (const c of it.ItemChargeAdjustmentList ?? []) {
          if (c.ChargeType === 'Principal') refunds += c.ChargeAmount?.CurrencyAmount ?? 0;       // negative
        }
        for (const f of it.ItemFeeAdjustmentList ?? []) fees += f.FeeAmount?.CurrencyAmount ?? 0;  // positive (fee returned)
      }
    }
    nextToken = data.payload?.NextToken;
    if (!nextToken) break;
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const grossR = round(gross);
  const feesPos = Math.abs(round(fees));
  const refundsPos = Math.abs(round(refunds));
  const promoPos = Math.abs(round(promotions));
  return {
    gross: grossR,
    fees: feesPos,
    refunds: refundsPos,
    promotions: promoPos,
    net: round(grossR - feesPos - refundsPos - promoPos),
    currency,
    orderCount: orders.size,
  };
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
