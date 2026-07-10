import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// eBay Post-Order API — buyer-initiated return cases. Uses the seller's user
// OAuth token with the legacy `IAF` auth scheme (Post-Order doesn't accept Bearer).
const PO_BASE = 'https://api.ebay.com/post-order/v2';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
async function getSetting(k: string): Promise<string | null> {
  const { data } = await getSupabase().from('app_settings').select('value').eq('key', k).maybeSingle();
  return data?.value ?? null;
}
async function setSetting(k: string, v: string) {
  await getSupabase().from('app_settings').upsert({ key: k, value: v, updated_at: new Date().toISOString() });
}

async function getUserToken(): Promise<string | null> {
  const refreshToken = process.env.EBAY_REFRESH_TOKEN ?? (await getSetting('ebay_refresh_token'));
  const access = await getSetting('ebay_access_token');
  const expiresAt = Number((await getSetting('ebay_token_expires_at')) ?? '0');
  if (access && Date.now() < expiresAt - 5 * 60 * 1000) return access;
  if (!refreshToken) return access; // no refresh available — try the stored token anyway

  const creds = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: 'https://api.ebay.com/oauth/api_scope/sell.fulfillment' }),
  });
  if (!res.ok) { console.error('[eBay returns] token refresh failed', res.status); return access; }
  const data = await res.json() as { access_token: string; expires_in: number };
  await setSetting('ebay_access_token', data.access_token);
  await setSetting('ebay_token_expires_at', String(Date.now() + data.expires_in * 1000));
  return data.access_token;
}

interface ReturnMember {
  returnId?: string;
  orderId?: string;
  buyerLoginName?: string;
  currentType?: string;
  state?: string;
  status?: string;
  creationInfo?: {
    item?: { itemId?: string };
    reason?: string;
    reasonType?: string;
    creationDate?: { value?: string };
  };
  sellerTotalRefund?: { estimatedRefundAmount?: { value?: number; currency?: string } };
}

// GET — stored return cases for the view.
export async function GET() {
  const { data, error } = await getSupabase().from('ebay_returns').select('*').order('creation_date', { ascending: false }).limit(500);
  if (error) return NextResponse.json({ returns: [], error: error.message });
  return NextResponse.json({ returns: data ?? [] });
}

// POST — pull all return cases from eBay (paginated), attach listing photo, store.
export async function POST() {
  const token = await getUserToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  const supabase = getSupabase();

  const members: ReturnMember[] = [];
  let offset = 0, total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`${PO_BASE}/return/search?return_role=SELLER&limit=${PAGE_LIMIT}&offset=${offset}`, {
      headers: { Authorization: `IAF ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', Accept: 'application/json' },
    });
    if (!res.ok) {
      if (page === 0) return NextResponse.json({ error: 'ebay_api_error', status: res.status, message: (await res.text()).slice(0, 300) }, { status: 502 });
      break;
    }
    const data = await res.json() as { members?: ReturnMember[]; paginationOutput?: { totalEntries?: number } };
    const batch = data.members ?? [];
    members.push(...batch);
    total = data.paginationOutput?.totalEntries ?? total;
    offset += PAGE_LIMIT;
    if (batch.length < PAGE_LIMIT || offset >= total) break;
  }
  if (members.length === 0) return NextResponse.json({ synced: 0, total });

  // Listing photo/title from our cached listings, keyed by item id.
  const itemIds = [...new Set(members.map((m) => m.creationInfo?.item?.itemId).filter(Boolean))] as string[];
  const listing = new Map<string, { image_url?: string; title?: string }>();
  for (let i = 0; i < itemIds.length; i += 100) {
    const { data: rows } = await supabase.from('ebay_listings').select('item_id,image_url,title').in('item_id', itemIds.slice(i, i + 100));
    for (const r of rows ?? []) listing.set(r.item_id, { image_url: r.image_url, title: r.title });
  }

  const rows = members.filter((m) => m.returnId).map((m) => {
    const itemId = m.creationInfo?.item?.itemId ?? null;
    const l = itemId ? listing.get(itemId) : undefined;
    return {
      return_id: m.returnId,
      order_id: m.orderId ?? null,
      buyer_login: m.buyerLoginName ?? null,
      item_id: itemId,
      item_title: l?.title ?? null,
      image_url: l?.image_url ?? null,
      return_type: m.currentType ?? null,
      reason: m.creationInfo?.reason ?? null,
      reason_type: m.creationInfo?.reasonType ?? null,
      state: m.state ?? null,
      status: m.status ?? null,
      refund_amount: m.sellerTotalRefund?.estimatedRefundAmount?.value ?? null,
      currency: m.sellerTotalRefund?.estimatedRefundAmount?.currency ?? null,
      creation_date: m.creationInfo?.creationDate?.value ?? null,
      raw: m,
    };
  });

  const { error } = await supabase.from('ebay_returns').upsert(rows, { onConflict: 'return_id' });
  if (error) {
    console.error('[eBay returns] upsert failed', error.message);
    return NextResponse.json({ error: 'store_failed', fetched: rows.length, total, message: error.message }, { status: 500 });
  }
  return NextResponse.json({ synced: rows.length, total });
}
