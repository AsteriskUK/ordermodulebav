import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { mapEbayOrderToOrder } from '@/lib/ebay-mapper';
import { Order, Batch } from '@/lib/types';

const BASE_URL = 'https://api.ebay.com';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

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

  const cookieStore = await cookies();
  cookieStore.set('ebay_access_token', data.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: data.expires_in,
    path: '/',
  });
  cookieStore.set('ebay_token_expires_at', String(Date.now() + data.expires_in * 1000), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: data.expires_in,
    path: '/',
  });

  return data.access_token;
}

export async function GET(req: NextRequest) {
  // Prefer hardcoded refresh token from env (single-seller setup)
  const envRefreshToken = process.env.EBAY_REFRESH_TOKEN;

  const cookieStore = await cookies();
  const cookieAccessToken = cookieStore.get('ebay_access_token')?.value;
  const cookieRefreshToken = cookieStore.get('ebay_refresh_token')?.value;
  const expiresAt = Number(cookieStore.get('ebay_token_expires_at')?.value || '0');

  const refreshToken = envRefreshToken || cookieRefreshToken;

  if (!cookieAccessToken && !refreshToken) {
    return NextResponse.json({ error: 'not_connected', message: 'Not connected to eBay. Add EBAY_REFRESH_TOKEN to .env.local or connect via /api/ebay/auth.' }, { status: 401 });
  }

  let accessToken: string | undefined = cookieAccessToken;

  // If using env refresh token, always get a fresh access token (no cookie caching needed)
  if (envRefreshToken) {
    const fresh = await refreshAccessToken(envRefreshToken);
    if (!fresh) {
      return NextResponse.json({ error: 'token_error', message: 'Failed to obtain access token using EBAY_REFRESH_TOKEN. Token may be expired — re-run the OAuth flow.' }, { status: 401 });
    }
    accessToken = fresh;
  } else {
    // Auto-refresh cookie token if within 5 minutes of expiry
    if (accessToken && expiresAt && Date.now() > expiresAt - 5 * 60 * 1000 && cookieRefreshToken) {
      accessToken = await refreshAccessToken(cookieRefreshToken) || accessToken;
    }
    if (!accessToken && cookieRefreshToken) {
      accessToken = await refreshAccessToken(cookieRefreshToken) ?? undefined;
    }
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

    if (!res.ok) {
      const body = await res.text();
      console.error('[eBay orders] API error:', res.status, body);
      return NextResponse.json({ error: 'ebay_api_error', message: body }, { status: res.status });
    }

    const data = await res.json() as { orders?: unknown[]; total?: number };
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
}
