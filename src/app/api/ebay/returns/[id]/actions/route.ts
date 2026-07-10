import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting, updateEbayReturnRow } from '../../helpers';

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

export type EbayReturnAction =
  | 'SELLER_MARK_AS_RECEIVED'
  | 'SELLER_MARK_REPLACEMENT_SHIPPED'
  | 'SELLER_ISSUE_REFUND'
  | 'SELLER_VOID_LABEL'
  | 'SELLER_OFFER_PARTIAL_REFUND'
  | 'SUBMIT_FILE';

interface EbayReturnActionPayload {
  actionType: EbayReturnAction;
  refundAmount?: { value: number; currency?: string };
  comments?: { content?: string };
  // Add more fields as we wire up specific actions.
}

// POST — perform an action on an eBay return case via the Post-Order API.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Partial<EbayReturnActionPayload>;
  const { actionType, refundAmount, comments } = body;
  if (!actionType) return NextResponse.json({ error: 'missing_action_type' }, { status: 400 });

  const token = await getUserToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const payload: Record<string, unknown> = { actionType };
  if (refundAmount) payload.refundAmount = refundAmount;
  if (comments) payload.comments = comments;

  const res = await fetch(`${PO_BASE}/return/${id}/action`, {
    method: 'POST',
    headers: { Authorization: `IAF ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return NextResponse.json({ error: 'ebay_api_error', status: res.status, message: text.slice(0, 300) }, { status: 502 });
  }
  const result = await res.json().catch(() => ({}));

  // Pull the latest case details so our cached row reflects the new status/refund/etc.
  let detail: Record<string, unknown> | undefined;
  try {
    const detailRes = await fetch(`${PO_BASE}/return/${id}?fieldgroups=RETURN_DETAILS`, {
      headers: { Authorization: `IAF ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', Accept: 'application/json' },
    });
    if (detailRes.ok) {
      detail = await detailRes.json();
      if (detail) await updateEbayReturnRow(id, detail);
    }
  } catch { /* detail refresh failed but action succeeded; keep action result */ }

  return NextResponse.json({ ok: true, result, detail });
}
