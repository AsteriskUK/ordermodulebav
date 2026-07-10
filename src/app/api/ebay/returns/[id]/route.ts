import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting, updateEbayReturnRow } from '../helpers';

const PO_BASE = 'https://api.ebay.com/post-order/v2';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

async function getUserToken(): Promise<string | null> {
  const refreshToken = process.env.EBAY_REFRESH_TOKEN ?? (await getSetting('ebay_refresh_token'));
  const access = await getSetting('ebay_access_token');
  const expiresAt = Number((await getSetting('ebay_token_expires_at')) ?? '0');
  if (access && Date.now() < expiresAt - 5 * 60 * 1000) return access;
  if (!refreshToken) return access;

  const creds = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: 'https://api.ebay.com/oauth/api_scope/sell.fulfillment' }),
  });
  if (!res.ok) return access;
  const data = await res.json() as { access_token: string; expires_in: number };
  await setSetting('ebay_access_token', data.access_token);
  await setSetting('ebay_token_expires_at', String(Date.now() + data.expires_in * 1000));
  return data.access_token;
}

// GET — fetch full return case details from eBay and update the cached row.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getUserToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const res = await fetch(`${PO_BASE}/return/${id}?fieldgroups=RETURN_DETAILS`, {
    headers: { Authorization: `IAF ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', Accept: 'application/json' },
  });
  if (!res.ok) {
    return NextResponse.json({ error: 'ebay_api_error', status: res.status, message: (await res.text()).slice(0, 300) }, { status: 502 });
  }
  const detail = await res.json();
  await updateEbayReturnRow(id, detail);
  return NextResponse.json({ detail });
}
