// One-off backfill: import eBay orders missing from the orders table (sync gap
// around sales records 82093–82228, e.g. #82213), and repair item_number on
// existing rows (was the lineItemId; must be the listing's legacyItemId so
// listing photos resolve).
//
// Usage: node scripts/backfill-missing-ebay-orders.mjs [fromISO] [toISO]
// Defaults to the known gap window (2026-07-04 → 2026-07-09).
//
// Safe by design: inserts ONLY sales records that don't exist yet (fulfilled
// ones come in as 'shipped'); for existing rows it updates ONLY item_number.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

process.loadEnvFile?.('.env.local');
const env = (k) => process.env[k];

const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'));

const FROM = process.argv[2] ?? '2026-07-04T00:00:00.000Z';
const TO = process.argv[3] ?? '2026-07-09T00:00:00.000Z';
const BATCH_ID = 'a1b2c3d4-0000-5000-8000-eba1f111ba01'; // fixed UUID for this gap-fill batch

// ---- stableUuid (ported verbatim from src/lib/utils.ts so ids match the app) ----
function stableUuid(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 4) {
    const r = next();
    bytes[i] = r & 0xff;
    bytes[i + 1] = (r >>> 8) & 0xff;
    bytes[i + 2] = (r >>> 16) & 0xff;
    bytes[i + 3] = (r >>> 24) & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---- deriveShipping (ported from src/lib/csv-parser.ts) ----
function deriveShipping(postcode, totalPrice, postage) {
  const isBT = (postcode || '').trim().toUpperCase().startsWith('BT');
  if (postage > 0) return { carrier: 'DPD', type: 'express' };
  if (isBT) return { carrier: 'DPD', type: 'two_day' };
  if (totalPrice < 400) return { carrier: 'FedEx', type: 'standard' };
  if (totalPrice < 1000) return { carrier: 'DPD', type: 'standard' };
  return { carrier: 'DPD', type: 'next_day' };
}

async function getToken() {
  const { data: rt } = await supabase.from('app_settings').select('value').eq('key', 'ebay_refresh_token').single();
  const refresh = env('EBAY_REFRESH_TOKEN') ?? rt?.value;
  if (!refresh) throw new Error('No eBay refresh token');
  const creds = Buffer.from(`${env('EBAY_CLIENT_ID')}:${env('EBAY_CLIENT_SECRET')}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error(`token failed: ${JSON.stringify(d).slice(0, 200)}`);
  return d.access_token;
}

async function main() {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json' };
  const filter = `creationdate:[${FROM}..${TO}]`;

  const ebayOrders = [];
  for (let offset = 0; offset < 1000; offset += 200) {
    const url = `https://api.ebay.com/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=200&offset=${offset}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`orders fetch ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const d = await res.json();
    ebayOrders.push(...(d.orders ?? []));
    if ((d.orders ?? []).length < 200) break;
  }
  console.log(`eBay returned ${ebayOrders.length} orders for ${FROM} → ${TO}`);

  // Which sales records already exist?
  const srns = ebayOrders.map((o) => o.salesRecordReference || o.legacyOrderId || o.orderId).filter(Boolean);
  const existing = new Map();
  for (let i = 0; i < srns.length; i += 200) {
    const { data } = await supabase.from('orders').select('id,sales_record_number,item_number').in('sales_record_number', srns.slice(i, i + 200));
    for (const row of data ?? []) existing.set(row.sales_record_number, row);
  }

  // Ensure the batch row exists for inserted orders.
  await supabase.from('batches').upsert({ id: BATCH_ID, name: 'eBay gap fill (Jul 2026)', source: 'ebay', imported_at: new Date().toISOString() });

  let inserted = 0, itemFixed = 0, skipped = 0;
  for (const eo of ebayOrders) {
    const srn = eo.salesRecordReference || eo.legacyOrderId || eo.orderId;
    const shipTo = eo.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
    const addr = shipTo?.contactAddress ?? {};
    const items = eo.lineItems ?? [];
    const found = existing.get(srn);

    if (found) {
      // Repair item_number only (listing id) — never touch status/tracking/etc.
      const legacyId = items[0]?.legacyItemId;
      if (legacyId && found.item_number !== legacyId) {
        const { error } = await supabase.from('orders').update({ item_number: legacyId }).eq('id', found.id);
        if (!error) itemFixed++;
      } else skipped++;
      continue;
    }

    const totalPrice = parseFloat(eo.pricingSummary?.total?.value || '0');
    const postage = parseFloat(eo.pricingSummary?.deliveryCost?.value || '0');
    const { carrier, type } = deriveShipping(addr.postalCode || '', totalPrice, postage);
    const fulfilled = eo.orderFulfillmentStatus === 'FULFILLED';

    const rows = items.map((item, idx) => {
      const aspects = Array.isArray(item.variationAspects) && item.variationAspects.length
        ? item.variationAspects
        : (Array.isArray(item.properties) ? item.properties : []);
      const variation = aspects
        .filter((p) => p.name && p.value !== undefined && p.value !== '' && p.name.toUpperCase() !== 'SKU')
        .map((p) => `${p.name}: ${p.value}`).join(', ');
      return {
        id: stableUuid(`ebay-${eo.orderId}-${idx}`),
        sales_record_number: srn,
        order_number: eo.orderId,
        batch_id: BATCH_ID,
        buyer_username: eo.buyer?.username || '',
        buyer_name: eo.buyer?.buyerRegistrationAddress?.fullName || shipTo?.fullName || '',
        buyer_email: shipTo?.email || eo.buyer?.buyerRegistrationAddress?.email || '',
        buyer_note: '',
        post_to_name: shipTo?.fullName || addr.fullName || '',
        post_to_phone: shipTo?.phoneNumber || addr.phoneNumber || '',
        post_to_address1: addr.addressLine1 || '',
        post_to_address2: addr.addressLine2 || '',
        post_to_city: addr.city || '',
        post_to_county: addr.stateOrProvince || '',
        post_to_postcode: addr.postalCode || '',
        post_to_country: addr.countryCode === 'GB' ? 'United Kingdom' : (addr.countryCode || ''),
        is_gsp: (addr.countryCode || 'GB') !== 'GB',
        item_number: item.legacyItemId || item.lineItemId,
        item_title: item.title,
        custom_label: item.sku || '',
        variation,
        quantity: item.quantity,
        category: 'N/A',
        sold_for: parseFloat(item.lineItemCost?.value || '0') * item.quantity,
        postage_and_packaging: idx === 0 ? postage : 0,
        total_price: idx === 0 ? totalPrice : parseFloat(item.lineItemCost?.value || '0') * item.quantity,
        delivery_carrier: carrier,
        delivery_type: type,
        tracking_number: '',
        delivery_service: eo.fulfillmentStartInstructions?.[0]?.shippingStep?.shippingServiceCode || '',
        number_of_boxes: 1,
        label_qty: 1,
        priority: 5,
        status: fulfilled ? 'shipped' : 'pending',
        comments: '',
        sale_date: eo.creationDate || null,
        paid_on_date: eo.creationDate || null,
        post_by_date: eo.fulfillmentStartInstructions?.[0]?.shipByDate || null,
        dispatched_on_date: null,
        imported_at: new Date().toISOString(),
      };
    });

    if (rows.length) {
      const { error } = await supabase.from('orders').upsert(rows, { onConflict: 'id' });
      if (error) console.error(`  insert #${srn} failed:`, error.message);
      else inserted += rows.length;
    }
  }

  console.log(`Done. Inserted ${inserted} missing order rows, repaired item_number on ${itemFixed}, unchanged ${skipped}.`);
  const { data: check } = await supabase.from('orders').select('sales_record_number,status,item_number').eq('sales_record_number', '82213');
  console.log('82213 now:', JSON.stringify(check));
}

main().catch((e) => { console.error(e); process.exit(1); });
