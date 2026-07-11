import { NextRequest, NextResponse } from 'next/server';
import { updateEbayReturnRow } from '../../helpers';
import { getEbayUserToken as getUserToken } from '@/lib/ebay-client';

const PO_BASE = 'https://api.ebay.com/post-order/v2';

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
