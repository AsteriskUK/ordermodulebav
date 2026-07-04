import crypto from 'crypto';
import { Order } from './types';
import { deriveShipping } from './csv-parser';
import { deriveCategory } from './categoriser';
import { stableUuid } from './utils';

const TEMU_API_URL = 'https://openapi-b-eu.temu.com/openapi/router';

// ─── Credentials ─────────────────────────────────────────────────────────────

export function getTemuCredentials(): { appKey: string; appSecret: string; accessToken: string } | null {
  const appKey = process.env.TEMU_APP_KEY;
  const appSecret = process.env.TEMU_APP_SECRET;
  const accessToken = process.env.TEMU_ACCESS_TOKEN;
  if (!appKey || !appSecret || !accessToken) return null;
  return { appKey, appSecret, accessToken };
}

export function isTemuConfigured(): boolean {
  return !!getTemuCredentials();
}

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * Temu sign: sort all params by key, concatenate key+value pairs,
 * wrap with appSecret, MD5 uppercase.
 */
export function buildTemuSign(params: Record<string, unknown>, appSecret: string): string {
  const sorted = Object.keys(params).sort();
  let str = appSecret;
  for (const key of sorted) {
    const val = params[key];
    if (val === null || val === undefined) continue;
    str += key + (typeof val === 'object' ? JSON.stringify(val) : String(val));
  }
  str += appSecret;
  return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase();
}

// ─── Request helper ───────────────────────────────────────────────────────────

async function temuPost<T>(type: string, businessParams: Record<string, unknown>): Promise<T> {
  const creds = getTemuCredentials();
  if (!creds) throw new Error('Temu credentials not configured');

  const timestamp = String(Math.floor(Date.now() / 1000));

  const params: Record<string, unknown> = {
    ...businessParams,
    type,
    app_key: creds.appKey,
    access_token: creds.accessToken,
    timestamp,
    data_type: 'JSON',
  };

  const sign = buildTemuSign(params, creds.appSecret);
  params.sign = sign;

  const res = await fetch(TEMU_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const rawBody = await res.text();
  if (!res.ok) {
    throw new Error(`Temu HTTP error ${res.status}: ${rawBody.slice(0, 500)}`);
  }

  let json: { success: boolean; errorCode?: number; errorMsg?: string; result?: unknown };
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new Error(`Temu invalid JSON: ${rawBody.slice(0, 500)}`);
  }

  if (!json.success) {
    throw new Error(`Temu API error ${json.errorCode}: ${json.errorMsg}`);
  }

  return json.result as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TemuOrderLabel {
  name: string;
  value: number;
}

export interface TemuProductItem {
  productSkuId: number;
  soldFactor: number;
  extCode: string;
  productId: number;
}

export interface TemuOrderLine {
  orderSn: string;
  goodsId: number;
  orderStatus: number;
  fulfillmentType: string;
  spec: string;
  goodsName: string;
  originalGoodsName?: string;
  skuId: number;
  quantity: number;
  originalOrderQuantity?: number;
  canceledQuantityBeforeShipment?: number;
  thumbUrl?: string;
  orderCreateTime: number;
  orderShippingTime?: number;
  orderLabel?: TemuOrderLabel[];
  packageAbnormalTypeList?: string[];
  orderPaymentType?: string;
  isCancelledDuringPending?: boolean;
  originalSpecName?: string;
  productList?: TemuProductItem[];
  inventoryDeductionWarehouseId?: string;
  inventoryDeductionWarehouseName?: string;
  earliestTimeGetShippingDocument?: number;
  qualificationUploadEndTime?: number;
  fulfillmentWarning?: string[];
}

export interface TemuParentOrder {
  parentOrderSn: string;
  parentOrderStatus: number;
  parentOrderTime: number;
  updateTime?: number;
  parentShippingTime?: number;
  latestDeliveryTime?: number;
  parentConfirmTime?: number;
  expectShipLatestTime?: number;
  shippingMethod?: number;
  regionId?: number;
  siteId?: number;
  orderPaymentType?: string;
  hasShippingFee?: boolean;
  batchOrderNumberList?: string[];
  parentOrderLabel?: TemuOrderLabel[];
  fulfillmentWarning?: string[];
  parentOrderPendingFinishTime?: number;
}

export interface TemuPageItem {
  parentOrderMap: TemuParentOrder;
  orderList: TemuOrderLine[];
}

export interface TemuOrderListResult {
  totalItemNum: number;
  pageItems: TemuPageItem[];
}

export interface TemuOrderDetailResult {
  parentOrderMap: TemuParentOrder & {
    regionName1?: string;
    regionName2?: string;
    regionName3?: string;
  };
  orderList: (TemuOrderLine & {
    hasUploadedEvidence?: boolean;
    packageSnInfo?: { packageSn: string; packageDeliveryType: number; applySn: string; needPod: boolean; callSuccess: boolean }[];
  })[];
}

// ─── Shipping address types ───────────────────────────────────────────────────

export interface TemuAddressExtra {
  firstName?: string;
  lastName?: string;
  additionalFirstName?: string;
  additionalLastName?: string;
}

export interface TemuShippingInfo {
  receiptName?: string;
  receiptAdditionalName?: string;
  addressExtra?: TemuAddressExtra;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  addressLineAll?: string;
  regionName1?: string; // country / top-level region
  regionName2?: string; // state / county
  regionName3?: string; // city
  regionName4?: string; // district
  postCode?: string;
  mobile?: string;
  backupMobile?: string;
  mail?: string;
  nationalAddress?: string;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function fetchTemuOrders(filters: {
  pageNumber?: number;
  pageSize?: number;
  parentOrderStatus?: number;
  parentOrderSnList?: string[];
  createAfter?: number;
  createBefore?: number;
  updateAtStart?: number;
  updateAtEnd?: number;
  sortby?: 'updateTime' | 'createTime';
} = {}): Promise<TemuOrderListResult> {
  return temuPost<TemuOrderListResult>('bg.order.list.v2.get', filters);
}

export async function fetchTemuOrderDetail(parentOrderSn: string): Promise<TemuOrderDetailResult> {
  return temuPost<TemuOrderDetailResult>('bg.order.detail.v2.get', { parentOrderSn });
}

export async function fetchTemuShippingInfo(parentOrderSn: string): Promise<TemuShippingInfo | null> {
  try {
    return await temuPost<TemuShippingInfo>('bg.order.decryptshippinginfo.get', { parentOrderSn });
  } catch {
    // Fall back to non-decrypted endpoint if decrypt fails (e.g. DPA not signed)
    try {
      return await temuPost<TemuShippingInfo>('bg.order.shippinginfo.v2.get', { parentOrderSn });
    } catch {
      return null;
    }
  }
}

/** Run up to `concurrency` async tasks at a time. */
async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function fetchTemuShippingInfoBatch(
  parentOrderSns: string[],
  concurrency = 5
): Promise<Map<string, TemuShippingInfo>> {
  const infos = await pMap(parentOrderSns, fetchTemuShippingInfo, concurrency);
  const map = new Map<string, TemuShippingInfo>();
  for (let i = 0; i < parentOrderSns.length; i++) {
    const info = infos[i];
    if (info) map.set(parentOrderSns[i], info);
  }
  return map;
}

// ─── Mapper ──────────────────────────────────────────────────────────────────

const ORDER_STATUS_MAP: Record<number, Order['status']> = {
  1: 'pending',   // PENDING
  2: 'pending',   // UN_SHIPPING (awaiting shipment)
  3: 'cancelled', // CANCELED
  4: 'shipped',   // SHIPPED
  5: 'delivered', // RECEIPTED
  41: 'shipped',  // Partially shipped
  51: 'delivered',// Partially received
};

export function mapTemuPageItemToOrders(
  item: TemuPageItem,
  batchId: string,
  shippingInfo?: TemuShippingInfo
): Order[] {
  const parent = item.parentOrderMap;
  const lines = item.orderList ?? [];

  const saleDate = parent.parentOrderTime
    ? new Date(parent.parentOrderTime * 1000).toISOString()
    : new Date().toISOString();

  const status: Order['status'] = ORDER_STATUS_MAP[parent.parentOrderStatus] ?? 'pending';

  // Resolve address fields from shipping info
  const postToName = shippingInfo?.receiptName ||
    [shippingInfo?.addressExtra?.firstName, shippingInfo?.addressExtra?.lastName].filter(Boolean).join(' ') ||
    '';
  const postToPhone = shippingInfo?.mobile || shippingInfo?.backupMobile || '';
  const postToAddress1 = shippingInfo?.addressLine1 || shippingInfo?.addressLineAll || '';
  const postToAddress2 = shippingInfo?.addressLine2 || '';
  const postToCity = shippingInfo?.regionName3 || '';
  const postToCounty = shippingInfo?.regionName2 || '';
  const postToPostcode = shippingInfo?.postCode || '';
  const postToCountry = shippingInfo?.regionName1 || '';
  const buyerEmail = shippingInfo?.mail || '';
  const { deliveryCarrier, deliveryType } = deriveShipping(postToPostcode, 0, 0);

  const addressBase = {
    postToName, postToPhone, postToAddress1, postToAddress2,
    postToCity, postToCounty, postToPostcode, postToCountry,
    buyerEmail,
  };

  if (lines.length === 0) {
    return [{
      id: stableUuid(`temu-${parent.parentOrderSn}`),
      salesRecordNumber: parent.parentOrderSn,
      orderNumber: parent.parentOrderSn,
      buyerUsername: '',
      buyerName: postToName,
      buyerNote: '',
      ...addressBase,
      itemNumber: '',
      itemTitle: '',
      customLabel: '',
      variation: '',
      quantity: 1,
      soldFor: 0,
      postageAndPackaging: 0,
      totalPrice: 0,
      priority: 5,
      numberOfBoxes: 1,
      saleDate,
      paidOnDate: saleDate,
      postByDate: '',
      dispatchedOnDate: parent.parentShippingTime ? new Date(parent.parentShippingTime * 1000).toISOString() : '',
      deliveryService: '',
      trackingNumber: '',
      deliveryCarrier,
      deliveryType,
      status,
      category: 'N/A',
      comments: '',
      labelQty: 1,
      isGSP: postToCountry !== 'United Kingdom' && postToCountry !== 'GB' && postToCountry !== '',
      extendedLiability: false,
      importedAt: new Date().toISOString(),
      batchId,
    }];
  }

  return lines.map((line, idx): Order => {
    const itemTitle = line.goodsName || line.originalGoodsName || '';
    const variation = line.spec || line.originalSpecName || '';
    const quantity = line.quantity || 1;
    const category = deriveCategory(itemTitle);

    return {
      id: stableUuid(`temu-${parent.parentOrderSn}-${line.orderSn || idx}`),
      salesRecordNumber: parent.parentOrderSn,
      orderNumber: parent.parentOrderSn,
      buyerUsername: '',
      buyerName: postToName,
      buyerNote: '',
      ...addressBase,
      itemNumber: String(line.goodsId || line.skuId || ''),
      itemTitle,
      customLabel: String(line.skuId || ''),
      variation,
      quantity,
      soldFor: 0,
      postageAndPackaging: 0,
      totalPrice: 0,
      priority: 5,
      numberOfBoxes: 1,
      saleDate,
      paidOnDate: saleDate,
      postByDate: parent.expectShipLatestTime
        ? new Date(parent.expectShipLatestTime * 1000).toISOString()
        : '',
      dispatchedOnDate: parent.parentShippingTime
        ? new Date(parent.parentShippingTime * 1000).toISOString()
        : '',
      deliveryService: '',
      trackingNumber: '',
      deliveryCarrier,
      deliveryType,
      status,
      category,
      comments: '',
      labelQty: 1,
      isGSP: postToCountry !== 'United Kingdom' && postToCountry !== 'GB' && postToCountry !== '',
      extendedLiability: false,
      importedAt: new Date().toISOString(),
      batchId,
    };
  });
}
