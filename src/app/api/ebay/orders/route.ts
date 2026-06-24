import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { mapEbayOrderToOrder } from '@/lib/ebay-mapper';
import { Order, Batch } from '@/lib/types';

const BASE_URL = 'https://api.ebay.com';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function getDbSetting(key: string): Promise<string | null> {
  const { data } = await getSupabase().from('app_settings').select('value').eq('key', key).single();
  return data?.value ?? null;
}

async function setDbSetting(key: string, value: string) {
  await getSupabase().from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.EBAY_CLIENT_ID!;
  const clientSecret = process.env.EBAY_CLIENT_SECRET!;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { access_token: string; expires_in: number };

  const expiresAt = Date.now() + data.expires_in * 1000;
  await setDbSetting('ebay_access_token', data.access_token);
  await setDbSetting('ebay_token_expires_at', String(expiresAt));

  return data.access_token;
}

export async function GET(req: NextRequest) {
  try {
  // Env var takes priority (manual override)
  const envRefreshToken = process.env.EBAY_REFRESH_TOKEN;

  const [dbRefreshTokenRow, dbAccessTokenRow, dbExpiresAtRow] = await Promise.all([
    envRefreshToken ? Promise.resolve(null) : getDbSetting('ebay_refresh_token'),
    getDbSetting('ebay_access_token'),
    getDbSetting('ebay_token_expires_at'),
  ]);
  const dbRefreshToken = envRefreshToken ?? dbRefreshTokenRow;
  const dbAccessToken = dbAccessTokenRow;
  const expiresAt = Number(dbExpiresAtRow ?? '0');

  if (!dbRefreshToken) {
    return NextResponse.json({ error: 'not_connected', message: 'Not connected to eBay. Connect via /api/ebay/auth.' }, { status: 401 });
  }

  let accessToken: string | null = dbAccessToken;

  // Refresh if missing or within 5 minutes of expiry
  if (!accessToken || (expiresAt && Date.now() > expiresAt - 5 * 60 * 1000)) {
    accessToken = await refreshAccessToken(dbRefreshToken);
  }

  if (!accessToken) {
    return NextResponse.json({ error: 'token_expired', message: 'eBay session expired. Please re-authorise.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const daysBack = parseInt(searchParams.get('days') || '7');
  const filter = searchParams.get('filter') || 'orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}';

  const fromDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  const allOrders: Order[] = [];
  let offset = 0;
  const limit = 200;
  const batchId = `ebay-${new Date().toISOString().slice(0, 10)}-${Date.now()}`;

  const batch: Batch = {
    id: batchId,
    name: `eBay Import ${new Date().toLocaleDateString('en-GB')}`,
    importedAt: new Date().toISOString(),
    orderCount: 0,
    source: 'ebay',
  };

  while (true) {
    const url = `${BASE_URL}/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&creationdate:[${fromDate}..]&limit=${limit}&offset=${offset}`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
      },
    });

    const rawBody = await res.text();
    console.log('[eBay orders] status:', res.status, 'body preview:', rawBody.slice(0, 300));

    if (!res.ok) {
      console.error('[eBay orders] API error:', res.status, rawBody);
      return NextResponse.json({ error: 'ebay_api_error', message: rawBody }, { status: res.status });
    }

    let data: { orders?: unknown[]; total?: number };
    try {
      data = JSON.parse(rawBody);
    } catch {
      console.error('[eBay orders] Failed to parse JSON:', rawBody.slice(0, 500));
      return NextResponse.json({ error: 'invalid_json', message: rawBody.slice(0, 500) }, { status: 502 });
    }
    const pageOrders = data.orders || [];

    for (const ebayOrder of pageOrders) {
      const mapped = mapEbayOrderToOrder(ebayOrder as Parameters<typeof mapEbayOrderToOrder>[0], batchId);
      allOrders.push(...mapped);
    }

    if (pageOrders.length < limit) break;
    offset += limit;
  }

  batch.orderCount = allOrders.length;

  return NextResponse.json({ orders: allOrders, batch });
  } catch (err) {
    console.error('[eBay orders] Unhandled error:', err);
    return NextResponse.json({ error: 'server_error', message: String(err) }, { status: 500 });
  }
}
