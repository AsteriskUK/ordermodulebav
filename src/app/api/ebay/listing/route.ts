import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BROWSE_BASE = 'https://api.ebay.com/buy/browse/v1';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const APP_SCOPE = 'https://api.ebay.com/oauth/api_scope';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // refresh listing data weekly

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

// Client-credentials (application) token — Browse only needs the base scope, so we
// don't touch the user refresh token. Cached in app_settings.
async function getAppToken(): Promise<string | null> {
  const supabase = getSupabase();
  const [{ data: at }, { data: exp }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'ebay_app_access_token').single(),
    supabase.from('app_settings').select('value').eq('key', 'ebay_app_token_expires_at').single(),
  ]);
  if (at?.value && Date.now() < Number(exp?.value ?? 0) - 5 * 60 * 1000) return at.value;

  const creds = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: APP_SCOPE }),
  });
  if (!res.ok) { console.error('[eBay listing] app token failed', res.status, (await res.text()).slice(0, 200)); return null; }
  const data = await res.json() as { access_token: string; expires_in: number };
  await supabase.from('app_settings').upsert([
    { key: 'ebay_app_access_token', value: data.access_token, updated_at: new Date().toISOString() },
    { key: 'ebay_app_token_expires_at', value: String(Date.now() + data.expires_in * 1000), updated_at: new Date().toISOString() },
  ]);
  return data.access_token;
}

// GET /api/ebay/listing?itemId=123 — cached listing image/title/price for a legacy item id.
export async function GET(req: NextRequest) {
  const itemId = new URL(req.url).searchParams.get('itemId');
  if (!itemId || !/^\d+$/.test(itemId)) return NextResponse.json({ error: 'valid itemId required' }, { status: 400 });

  const supabase = getSupabase();

  // 1. Serve from cache if fresh
  const { data: cached } = await supabase.from('ebay_listings').select('*').eq('item_id', itemId).single();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
    return NextResponse.json({ listing: cached, cached: true });
  }

  // 2. Fetch from eBay Browse
  const token = await getAppToken();
  if (!token) {
    if (cached) return NextResponse.json({ listing: cached, cached: true, stale: true });
    return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  }

  const headers = { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json' };

  type BrowseItem = {
    title?: string;
    image?: { imageUrl?: string };
    additionalImages?: { imageUrl?: string }[];
    price?: { value?: string; currency?: string };
    itemWebUrl?: string;
  };

  // Single-item listing first; multi-variation listings need the item-group endpoint.
  let item: BrowseItem | null = null;
  const single = await fetch(`${BROWSE_BASE}/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(itemId)}`, { headers });
  if (single.ok) {
    item = await single.json() as BrowseItem;
  } else {
    const group = await fetch(`${BROWSE_BASE}/item/get_items_by_item_group?item_group_id=${encodeURIComponent(itemId)}`, { headers });
    if (group.ok) {
      const g = await group.json() as { items?: BrowseItem[] };
      item = g.items?.[0] ?? null;
    }
  }

  if (!item) {
    // Ended/invalid listing — fall back to any cached copy.
    if (cached) return NextResponse.json({ listing: cached, cached: true, stale: true });
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const listing = {
    item_id: itemId,
    title: item.title ?? null,
    image_url: item.image?.imageUrl ?? null,
    additional_images: (item.additionalImages ?? []).map((a) => a.imageUrl).filter(Boolean),
    price: item.price?.value ? Number(item.price.value) : null,
    currency: item.price?.currency ?? null,
    web_url: item.itemWebUrl ?? null,
    fetched_at: new Date().toISOString(),
  };
  await supabase.from('ebay_listings').upsert(listing);
  return NextResponse.json({ listing, cached: false });
}
