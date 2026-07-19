import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-admin';
import { createHash } from 'crypto';
import { mapEbayOrderToOrder } from '@/lib/ebay-mapper';
import { getEbayUserToken } from '@/lib/ebay-client';
import { Order } from '@/lib/types';

const BASE_URL = 'https://api.ebay.com';

// Small batches on purpose: one page per call so a single request stays light
// and well within serverless limits. The client loops until done.
const PAGE_SIZE = 50;
const WINDOW_DAYS = 14;            // date window width (keeps each window under eBay's ~1000-result cap)
const BACKFILL_DAYS = 720;         // just under eBay's 2-year limit (avoids the 30830 boundary error)
const OFFSET_CAP = 1000;           // eBay won't page past ~1000 within one filter
const CURSOR_KEY = 'ebay_backfill_cursor';
const BACKFILL_BATCH_ID = 'a1b2c3d4-0000-5000-8000-eba1f111ba00'; // fixed UUID for the historical batch

function getSupabase() {
  return getServiceClient();
}

// Deterministic UUID v5 (SHA-1) so the same eBay order always maps to the same row.
function uuidv5(name: string): string {
  const ns = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'.replace(/-/g, '');
  const nsBytes = Buffer.from(ns, 'hex');
  const hash = createHash('sha1').update(nsBytes).update(name).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function getSetting(key: string): Promise<string | null> {
  const { data } = await getSupabase().from('app_settings').select('value').eq('key', key).single();
  return data?.value ?? null;
}
async function setSetting(key: string, value: string) {
  await getSupabase().from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
}

// Shared all-scopes user token (see getEbayUserToken) — avoids scope clobbering.
const getAccessToken = getEbayUserToken;

interface Cursor { windowEndMs: number; offset: number; imported: number; pages: number; done: boolean; }

const DELIVERY_TYPES = ['standard', 'next_day', 'two_day', 'express', 'collection'];
const DELIVERY_CARRIERS = ['DPD', 'FedEx', 'Parcelforce', 'Royal Mail', 'Other'];

function orderToRow(o: Order) {
  // Clamp to the DB's allowed sets so a single odd value can't fail the whole page upsert.
  const deliveryType = DELIVERY_TYPES.includes(o.deliveryType) ? o.deliveryType : 'standard';
  const deliveryCarrier = DELIVERY_CARRIERS.includes(o.deliveryCarrier) ? o.deliveryCarrier : 'Other';
  return {
    id: o.id, sales_record_number: o.salesRecordNumber, order_number: o.orderNumber, batch_id: BACKFILL_BATCH_ID,
    buyer_username: o.buyerUsername, buyer_name: o.buyerName, buyer_email: o.buyerEmail, buyer_note: o.buyerNote,
    post_to_name: o.postToName, post_to_phone: o.postToPhone, post_to_address1: o.postToAddress1, post_to_address2: o.postToAddress2,
    post_to_city: o.postToCity, post_to_county: o.postToCounty, post_to_postcode: o.postToPostcode, post_to_country: o.postToCountry,
    is_gsp: o.isGSP, item_number: o.itemNumber, item_title: o.itemTitle, custom_label: o.customLabel, variation: o.variation,
    quantity: o.quantity, category: o.category, sold_for: o.soldFor, postage_and_packaging: o.postageAndPackaging, total_price: o.totalPrice,
    delivery_carrier: deliveryCarrier, delivery_type: deliveryType, tracking_number: o.trackingNumber, delivery_service: o.deliveryService,
    // Historical records are archived so they never enter the active assembling/packing
    // queue or inflate dashboards — they exist for history/reporting only.
    number_of_boxes: o.numberOfBoxes, label_qty: o.labelQty, priority: o.priority, status: 'archived', comments: o.comments,
    sale_date: o.saleDate || null, paid_on_date: o.paidOnDate || null, post_by_date: o.postByDate || null, dispatched_on_date: o.dispatchedOnDate || null,
    imported_at: o.importedAt,
    metadata: {
      buyer_address1: o.buyerAddress1, buyer_address2: o.buyerAddress2, buyer_city: o.buyerCity,
      buyer_county: o.buyerCounty, buyer_postcode: o.buyerPostcode, buyer_country: o.buyerCountry, historical: true,
    },
  };
}

// POST /api/ebay/orders/backfill   → processes ONE page; call repeatedly until done.
// POST .../backfill?reset=1        → restart the backfill from the newest window.
export async function POST(req: Request) {
  const reset = new URL(req.url).searchParams.get('reset') === '1';
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'not_connected', message: 'Not connected to eBay.' }, { status: 401 });

  const supabase = getSupabase();
  const oldestMs = Date.now() - BACKFILL_DAYS * 86400000;

  // Load / init cursor
  let cursor: Cursor;
  const raw = reset ? null : await getSetting(CURSOR_KEY);
  if (raw) {
    try { cursor = JSON.parse(raw); } catch { cursor = { windowEndMs: Date.now(), offset: 0, imported: 0, pages: 0, done: false }; }
  } else {
    cursor = { windowEndMs: Date.now(), offset: 0, imported: 0, pages: 0, done: false };
    // Ensure the historical batch row exists.
    await supabase.from('batches').upsert({ id: BACKFILL_BATCH_ID, name: 'eBay Historical (2y)', source: 'ebay', imported_at: new Date().toISOString() });
  }

  if (cursor.done || cursor.windowEndMs <= oldestMs) {
    cursor.done = true;
    await setSetting(CURSOR_KEY, JSON.stringify(cursor));
    return NextResponse.json({ done: true, imported: cursor.imported, message: 'Backfill complete' });
  }

  const windowStartMs = Math.max(oldestMs, cursor.windowEndMs - WINDOW_DAYS * 86400000);
  const from = new Date(windowStartMs).toISOString();
  const to = new Date(cursor.windowEndMs).toISOString();
  const filter = `creationdate:[${from}..${to}]`;
  const url = `${BASE_URL}/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=${PAGE_SIZE}&offset=${cursor.offset}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' },
  });
  const body = await res.text();
  if (!res.ok) {
    console.error('[eBay backfill] API error', res.status, body.slice(0, 300));
    return NextResponse.json({ error: 'ebay_api_error', status: res.status, message: body.slice(0, 300) }, { status: 502 });
  }

  let data: { orders?: unknown[]; total?: number };
  try { data = JSON.parse(body); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 502 }); }
  const pageOrders = data.orders ?? [];

  // Map → rows with deterministic UUIDs, upsert (idempotent on re-run).
  const rows = pageOrders.flatMap((eo) => {
    const orderId = (eo as { orderId?: string }).orderId ?? '';
    return mapEbayOrderToOrder(eo as Parameters<typeof mapEbayOrderToOrder>[0], BACKFILL_BATCH_ID)
      .map((o, idx) => orderToRow({ ...o, id: uuidv5(`ebay-order-${orderId}-${idx}`) }));
  });

  let savedThisCall = 0;
  if (rows.length > 0) {
    const { error } = await supabase.from('orders').upsert(rows, { onConflict: 'id' });
    if (error) {
      console.error('[eBay backfill] upsert error', error.message);
      return NextResponse.json({ error: 'db_error', message: error.message }, { status: 500 });
    }
    savedThisCall = rows.length;
  }

  // Advance cursor: next page, or next (older) window when this one is exhausted.
  cursor.imported += savedThisCall;
  cursor.pages += 1;
  const windowExhausted = pageOrders.length < PAGE_SIZE || cursor.offset + PAGE_SIZE >= OFFSET_CAP;
  if (windowExhausted) {
    cursor.windowEndMs = windowStartMs;   // step to the older window
    cursor.offset = 0;
    if (cursor.windowEndMs <= oldestMs) cursor.done = true;
  } else {
    cursor.offset += PAGE_SIZE;
  }
  await setSetting(CURSOR_KEY, JSON.stringify(cursor));

  return NextResponse.json({
    done: cursor.done,
    savedThisCall,
    totalImported: cursor.imported,
    window: { from, to },
    nextOffset: cursor.offset,
    pageCount: pageOrders.length,
  });
}

// GET → current progress (read-only)
export async function GET() {
  const raw = await getSetting(CURSOR_KEY);
  if (!raw) return NextResponse.json({ started: false });
  try {
    const c = JSON.parse(raw) as Cursor;
    const oldestMs = Date.now() - BACKFILL_DAYS * 86400000;
    const span = Date.now() - oldestMs;
    const progressed = Math.min(span, Date.now() - c.windowEndMs);
    return NextResponse.json({ started: true, done: c.done, imported: c.imported, pages: c.pages, percent: Math.round((progressed / span) * 100) });
  } catch { return NextResponse.json({ started: false }); }
}
