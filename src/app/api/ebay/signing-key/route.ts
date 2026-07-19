import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-admin';
import { getSigningKey, signEbayRequest } from '@/lib/ebay-signature';

const FINANCES_BASE = 'https://apiz.ebay.com/sell/finances/v1';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const FINANCES_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.finances';

function getSupabase() {
  return getServiceClient();
}

async function getFinancesToken(): Promise<string | null> {
  const sb = getSupabase();
  const get = async (k: string) => (await sb.from('app_settings').select('value').eq('key', k).single()).data?.value ?? null;
  const refreshToken = process.env.EBAY_REFRESH_TOKEN ?? (await get('ebay_refresh_token'));
  if (!refreshToken) return null;
  const creds = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: FINANCES_SCOPE }),
  });
  if (!res.ok) return null;
  return (await res.json() as { access_token: string }).access_token;
}

// GET /api/ebay/signing-key           → provision (if needed) and report key status
// GET /api/ebay/signing-key?force=1   → force-create a fresh signing key
// GET /api/ebay/signing-key?test=1    → also make a signed Finances call and report the raw result
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // force (mints a new key) and test (returns raw financial data) are diagnostic
  // only — gate them behind the debug flag since this endpoint is unauthenticated.
  const debugEnabled = process.env.EBAY_METRICS_DEBUG === '1';
  const force = debugEnabled && searchParams.get('force') === '1';
  const test = debugEnabled && searchParams.get('test') === '1';

  let key;
  try {
    key = await getSigningKey(force);
  } catch (e) {
    return NextResponse.json({ ok: false, stage: 'create_key', error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const status: Record<string, unknown> = {
    ok: true,
    hasKey: !!key.jwe,
    keyId: key.keyId ?? null,
    cipher: key.cipher,
    expiry: new Date(key.expiry).toISOString(),
  };

  if (test) {
    const token = await getFinancesToken();
    if (!token) {
      status.test = { ok: false, error: 'no finances token (refresh token missing sell.finances scope)' };
      return NextResponse.json(status);
    }
    const now = new Date();
    const days = parseInt(searchParams.get('days') || '30', 10);
    const txnStatus = searchParams.get('status') || 'PAYOUT';
    const start = new Date(now.getTime() - days * 24 * 3600 * 1000).toISOString();
    const txns = searchParams.get('txns') === '1';
    const statusPart = txnStatus === 'NONE' ? '' : `transactionStatus:{${txnStatus}},`;
    const filter = txns
      ? `transactionType:{SALE},${statusPart}transactionDate:[${start}..${now.toISOString()}]`
      : `${statusPart}transactionDate:[${start}..${now.toISOString()}]`;
    const url = txns
      ? `${FINANCES_BASE}/transaction?filter=${encodeURIComponent(filter)}&limit=2`
      : `${FINANCES_BASE}/transaction_summary?filter=${encodeURIComponent(filter)}`;
    try {
      const sig = await signEbayRequest({ method: 'GET', url });
      const fr = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json', ...sig },
      });
      const body = await fr.text();
      status.test = { status: fr.status, ok: fr.ok, body: body.slice(0, 2500) };
    } catch (e) {
      status.test = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json(status);
}
