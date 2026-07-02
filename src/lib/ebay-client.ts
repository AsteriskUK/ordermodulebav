import { createClient } from '@supabase/supabase-js';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
export const EBAY_BASE_URL = 'https://api.ebay.com';
export const EBAY_MARKETPLACE_ID = 'EBAY_GB';

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

async function doRefresh(refreshToken: string): Promise<string | null> {
  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID!}:${process.env.EBAY_CLIENT_SECRET!}`
  ).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + data.expires_in * 1000;

  // Own cache key — this token carries ALL granted scopes (inventory/account).
  // The orders/backfill routes clobber `ebay_access_token` with a fulfillment-only
  // token, so listings must not share that key.
  await Promise.all([
    setDbSetting('ebay_listing_access_token', data.access_token),
    setDbSetting('ebay_listing_token_expires_at', String(expiresAt)),
  ]);

  return data.access_token;
}

export async function getEbayAppToken(): Promise<string | null> {
  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID!}:${process.env.EBAY_CLIENT_SECRET!}`
  ).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function getEbayAccessToken(): Promise<string | null> {
  const envRefreshToken = process.env.EBAY_REFRESH_TOKEN;

  const [dbRefreshToken, dbAccessToken, dbExpiresAt] = await Promise.all([
    envRefreshToken ? Promise.resolve(null) : getDbSetting('ebay_refresh_token'),
    getDbSetting('ebay_listing_access_token'),
    getDbSetting('ebay_listing_token_expires_at'),
  ]);

  const refreshTokenValue = envRefreshToken ?? dbRefreshToken;
  if (!refreshTokenValue) return null;

  const expiresAt = Number(dbExpiresAt ?? '0');
  const isValid = dbAccessToken && expiresAt && Date.now() < expiresAt - 5 * 60 * 1000;

  return isValid ? dbAccessToken : doRefresh(refreshTokenValue);
}
