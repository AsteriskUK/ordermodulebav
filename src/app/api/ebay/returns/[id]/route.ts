import { NextRequest, NextResponse } from 'next/server';
import { updateEbayReturnRow } from '../helpers';
import { getEbayUserToken as getUserToken } from '@/lib/ebay-client';

const PO_BASE = 'https://api.ebay.com/post-order/v2';

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
