import { NextResponse } from 'next/server';
import { getSupabase, getSetting, setSetting } from './helpers';
import { getEbayUserToken } from '@/lib/ebay-client';
import { stableUuid } from '@/lib/utils';

// eBay Post-Order API — buyer-initiated return cases. Uses the seller's user
// OAuth token with the legacy `IAF` auth scheme (Post-Order doesn't accept Bearer).
const PO_BASE = 'https://api.ebay.com/post-order/v2';
const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

// Shared all-scopes user token (see getEbayUserToken) — avoids scope clobbering.
const getUserToken = getEbayUserToken;

interface ReturnMember {
  returnId?: string;
  orderId?: string;
  buyerLoginName?: string;
  currentType?: string;
  state?: string;
  status?: string;
  creationInfo?: {
    item?: { itemId?: string };
    reason?: string;
    reasonType?: string;
    creationDate?: { value?: string };
    comments?: { content?: string };
  };
  sellerTotalRefund?: { estimatedRefundAmount?: { value?: number; currency?: string } };
  sellerAvailableOptions?: Array<{ actionType: string; actionURL?: string }>;
  sellerResponseDue?: { respondByDate?: { value?: string } };
}

// GET — stored return cases for the view.
export async function GET() {
  const { data, error } = await getSupabase().from('ebay_returns').select('*').order('creation_date', { ascending: false }).limit(500);
  if (error) return NextResponse.json({ returns: [], error: error.message });
  return NextResponse.json({ returns: data ?? [] });
}

// POST — pull return cases from eBay (incremental by default, full with ?force=true), attach listing photo, store.
export async function POST(req: Request) {
  const token = await getUserToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  const supabase = getSupabase();
  const { searchParams } = new URL(req.url);
  const forceFull = searchParams.get('force') === 'true';

  let members: ReturnMember[] = [];
  let offset = 0, total = 0;
  let incremental = false;

  // Try incremental sync using the most recent creation date we have stored.
  if (!forceFull) {
    const lastSync = await getSetting('ebay_returns_last_sync_at');
    const lastDate = lastSync ? new Date(lastSync) : null;
    if (lastDate && !isNaN(lastDate.getTime())) {
      // Small buffer (1 hour) to avoid missing returns created right at the boundary.
      const fromDate = new Date(lastDate.getTime() - 60 * 60 * 1000).toISOString();
      const toDate = new Date().toISOString();
      const filter = `creation_date_range:[${fromDate}..${toDate}]`;
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const res = await fetch(`${PO_BASE}/return/search?return_role=SELLER&limit=${PAGE_LIMIT}&offset=${offset}&filter=${encodeURIComponent(filter)}`, {
            headers: { Authorization: `IAF ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', Accept: 'application/json' },
          });
          if (!res.ok) { incremental = false; break; }
          const data = await res.json() as { members?: ReturnMember[]; paginationOutput?: { totalEntries?: number } };
          const batch = data.members ?? [];
          members.push(...batch);
          total = data.paginationOutput?.totalEntries ?? total;
          offset += PAGE_LIMIT;
          if (batch.length < PAGE_LIMIT || offset >= total) { incremental = true; break; }
        }
      } catch { incremental = false; members = []; offset = 0; total = 0; }
    }
  }

  // Fallback to full sync if incremental didn't run or failed.
  if (!incremental) {
    members = [];
    offset = 0;
    total = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch(`${PO_BASE}/return/search?return_role=SELLER&limit=${PAGE_LIMIT}&offset=${offset}`, {
        headers: { Authorization: `IAF ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', Accept: 'application/json' },
      });
      if (!res.ok) {
        if (page === 0) return NextResponse.json({ error: 'ebay_api_error', status: res.status, message: (await res.text()).slice(0, 300) }, { status: 502 });
        break;
      }
      const data = await res.json() as { members?: ReturnMember[]; paginationOutput?: { totalEntries?: number } };
      const batch = data.members ?? [];
      members.push(...batch);
      total = data.paginationOutput?.totalEntries ?? total;
      offset += PAGE_LIMIT;
      if (batch.length < PAGE_LIMIT || offset >= total) break;
    }
  }
  if (members.length === 0) return NextResponse.json({ synced: 0, total });

  // Listing photo/title from our cached listings, keyed by item id.
  const itemIds = [...new Set(members.map((m) => m.creationInfo?.item?.itemId).filter(Boolean))] as string[];
  const listing = new Map<string, { image_url?: string; title?: string }>();
  for (let i = 0; i < itemIds.length; i += 100) {
    const { data: rows } = await supabase.from('ebay_listings').select('item_id,image_url,title').in('item_id', itemIds.slice(i, i + 100));
    for (const r of rows ?? []) listing.set(r.item_id, { image_url: r.image_url, title: r.title });
  }

  const rows = members.filter((m) => m.returnId).map((m) => {
    const itemId = m.creationInfo?.item?.itemId ?? null;
    const l = itemId ? listing.get(itemId) : undefined;
    return {
      return_id: m.returnId,
      order_id: m.orderId ?? null,
      buyer_login: m.buyerLoginName ?? null,
      item_id: itemId,
      item_title: l?.title ?? null,
      image_url: l?.image_url ?? null,
      return_type: m.currentType ?? null,
      reason: m.creationInfo?.reason ?? null,
      reason_type: m.creationInfo?.reasonType ?? null,
      state: m.state ?? null,
      status: m.status ?? null,
      refund_amount: m.sellerTotalRefund?.estimatedRefundAmount?.value ?? null,
      currency: m.sellerTotalRefund?.estimatedRefundAmount?.currency ?? null,
      creation_date: m.creationInfo?.creationDate?.value ?? null,
      raw: m,
    };
  });

  const { error } = await supabase.from('ebay_returns').upsert(rows, { onConflict: 'return_id' });
  if (error) {
    console.error('[eBay returns] upsert failed', error.message);
    return NextResponse.json({ error: 'store_failed', fetched: rows.length, total, message: error.message }, { status: 500 });
  }

  // Auto-create local ReturnRecords for eBay cases that match an existing order and aren't already linked.
  const orderNumbers = [...new Set(rows.map((r) => r.order_id).filter(Boolean))] as string[];
  const { data: existingReturns } = await supabase
    .from('returns')
    .select('metadata')
    .not('metadata->>ebay_return_id', 'is', null);
  const existingEbayReturnIds = new Set((existingReturns ?? []).map((r) => r.metadata?.ebay_return_id).filter(Boolean) as string[]);

  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_number, sales_record_number, buyer_username, item_title, total_price')
    .in('order_number', orderNumbers);
  const orderByNumber = new Map((orders ?? []).map((o) => [o.order_number, o]));

  // Capture EVERY return, even when we don't hold the local order yet (orders are
  // still being backfilled). Unmatched returns get order_id: null — the
  // returns.order_id FK allows null but not a non-existent id.
  const returnsToInsert = rows
    .filter((r) => r.return_id && !existingEbayReturnIds.has(r.return_id))
    .map((r) => {
      const order = r.order_id ? orderByNumber.get(r.order_id) : undefined;
      const raw = r.raw as ReturnMember;
      const reasonLabel = r.reason ? r.reason.replace(/_/g, ' ') : 'Return requested';
      return {
        id: stableUuid(`ebay-return-${r.return_id}`),
        order_id: order?.id ?? null,
        sales_record_number: order?.sales_record_number ?? r.order_id,
        order_number: order?.order_number ?? r.order_id,
        buyer_username: r.buyer_login || order?.buyer_username || null,
        item_title: r.item_title || order?.item_title || null,
        reason: reasonLabel,
        status: 'pending',
        notes: raw.creationInfo?.comments?.content || '',
        returned_at: r.creation_date || new Date().toISOString(),
        refund_amount: r.refund_amount,
        metadata: { platform: 'ebay', ebay_return_id: r.return_id, order_matched: !!order },
      };
    });

  if (returnsToInsert.length > 0) {
    // Upsert on id so re-syncs never fail on a row we already created.
    const { error: insertError } = await supabase.from('returns').upsert(returnsToInsert, { onConflict: 'id' });
    if (insertError) console.error('[eBay returns] auto-create local returns failed', insertError.message);
  }

  await setSetting('ebay_returns_last_sync_at', new Date().toISOString());
  return NextResponse.json({ synced: rows.length, total, created: returnsToInsert.length, incremental });
}
