import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

export interface EbayCancellationOrder {
  orderId: string;
  orderNumber?: string;
  salesRecordNumber?: string;
  buyerUsername?: string;
  itemTitle?: string;
  cancelStatus?: string;
  cancelReason?: string;
  createdAt?: string;
}

export async function GET() {
  try {
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
      return NextResponse.json({ error: 'not_connected' }, { status: 401 });
    }

    let accessToken: string | null = dbAccessToken;
    if (!accessToken || (expiresAt && Date.now() > expiresAt - 5 * 60 * 1000)) {
      accessToken = await refreshAccessToken(dbRefreshToken);
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'token_expired' }, { status: 401 });
    }

    // Filter for orders with a cancellation request (CANCELLATION_REQUESTED filter)
    const filter = 'cancelStatus:{CANCEL_REQUESTED}';
    const url = `${BASE_URL}/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=50`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
      },
    });

    const rawBody = await res.text();
    console.log('[eBay cancellations] status:', res.status, 'body preview:', rawBody.slice(0, 300));

    if (!res.ok) {
      return NextResponse.json({ cancellations: [] });
    }

    let data: { orders?: Record<string, unknown>[] };
    try {
      data = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ cancellations: [] });
    }

    const cancellations: EbayCancellationOrder[] = (data.orders ?? []).map((o) => {
      const lineItem = (o.lineItems as Record<string, unknown>[] | undefined)?.[0];
      const buyer = o.buyer as Record<string, unknown> | undefined;
      const cancelDetail = o.cancelDetail as Record<string, unknown> | undefined;
      return {
        orderId: o.orderId as string,
        orderNumber: o.orderId as string,
        buyerUsername: buyer?.username as string | undefined,
        itemTitle: lineItem?.title as string | undefined,
        cancelStatus: o.cancelStatus as string | undefined,
        cancelReason: cancelDetail?.cancelReason as string | undefined,
        createdAt: o.creationDate as string | undefined,
      };
    });

    return NextResponse.json({ cancellations });
  } catch (err) {
    console.error('[eBay cancellations] Error:', err);
    return NextResponse.json({ cancellations: [] });
  }
}
