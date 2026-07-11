import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { stableUuid } from '@/lib/utils';
import {
  isAmazonConfigured,
  requestReturnsReport,
  getReportStatus,
  getReportDocumentText,
  parseReturnsReport,
  AmazonReturn,
} from '@/lib/amazon-client';

// Amazon returns via the Reports API. Because report generation is async and the
// request endpoint is rate-limited (~1/min), we cache the reportId in app_settings
// and resume polling it on the next call instead of requesting a fresh report.
const REPORT_ID_KEY = 'amazon_returns_report_id';
const LAST_SYNC_KEY = 'amazon_returns_last_sync_at';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
async function getSetting(key: string): Promise<string | null> {
  const { data } = await getSupabase().from('app_settings').select('value').eq('key', key).single();
  return data?.value ?? null;
}
async function setSetting(key: string, value: string) {
  await getSupabase().from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
}
async function clearSetting(key: string) {
  await getSupabase().from('app_settings').delete().eq('key', key);
}

// A stable dedup id for a return: prefer Amazon's RMA, else order + sku.
function returnKey(r: AmazonReturn): string {
  return r.rmaId || `${r.orderId}:${r.sku ?? ''}`;
}

// GET — locally stored Amazon returns (auto-created rows in the platform-agnostic table).
export async function GET() {
  const { data, error } = await getSupabase()
    .from('returns')
    .select('*')
    .eq('metadata->>platform', 'amazon')
    .order('returned_at', { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ returns: [], error: error.message });
  return NextResponse.json({ returns: data ?? [] });
}

// POST — request/poll the returns report; when DONE, auto-create local returns.
export async function POST(req: NextRequest) {
  if (!isAmazonConfigured()) {
    return NextResponse.json(
      { error: 'not_configured', message: 'Amazon SP-API credentials not configured.' },
      { status: 401 },
    );
  }
  const daysBack = parseInt(new URL(req.url).searchParams.get('days') || '30', 10);

  try {
    let reportId = await getSetting(REPORT_ID_KEY);

    // No report in flight — request one and ask the caller to poll again shortly.
    if (!reportId) {
      reportId = await requestReturnsReport(daysBack);
      await setSetting(REPORT_ID_KEY, reportId);
      return NextResponse.json({ pending: true, reportId, message: 'Returns report requested — sync again in a moment.' });
    }

    const status = await getReportStatus(reportId);
    if (status.processingStatus === 'IN_QUEUE' || status.processingStatus === 'IN_PROGRESS') {
      return NextResponse.json({ pending: true, reportId, message: 'Report still generating — sync again in a moment.' });
    }
    if (status.processingStatus !== 'DONE' || !status.reportDocumentId) {
      // FATAL / CANCELLED — drop the cached id so the next sync starts fresh.
      await clearSetting(REPORT_ID_KEY);
      return NextResponse.json(
        { error: 'report_failed', message: `Amazon returns report ${status.processingStatus}. Try again.` },
        { status: 502 },
      );
    }

    const text = await getReportDocumentText(status.reportDocumentId);
    const returns = parseReturnsReport(text);
    await clearSetting(REPORT_ID_KEY);
    await setSetting(LAST_SYNC_KEY, new Date().toISOString());

    if (returns.length === 0) return NextResponse.json({ synced: 0, created: 0 });

    const supabase = getSupabase();

    // Dedup against returns we've already created for this platform.
    const { data: existing } = await supabase
      .from('returns')
      .select('metadata')
      .eq('metadata->>platform', 'amazon');
    const existingKeys = new Set(
      (existing ?? []).map((r) => (r.metadata as { amazon_return_id?: string })?.amazon_return_id).filter(Boolean) as string[],
    );

    // Match returns to local orders by Amazon order id (stored as order_number).
    const orderIds = [...new Set(returns.map((r) => r.orderId))];
    const { data: orders } = await supabase
      .from('orders')
      .select('id, order_number, sales_record_number, buyer_username, item_title')
      .in('order_number', orderIds);
    const orderByNumber = new Map((orders ?? []).map((o) => [o.order_number, o]));

    // Capture EVERY return, even when we don't hold the local order yet (orders
    // are still being backfilled). Unmatched returns get order_id: null — the
    // returns.order_id FK allows null but not a non-existent id.
    const toInsert = returns
      .filter((r) => !existingKeys.has(returnKey(r)))
      .map((r) => {
        const order = orderByNumber.get(r.orderId);
        const returnedAt = r.returnDate && !Number.isNaN(Date.parse(r.returnDate))
          ? new Date(r.returnDate).toISOString()
          : new Date().toISOString();
        return {
          id: stableUuid(`amazon-return-${returnKey(r)}`),
          order_id: order?.id ?? null,
          sales_record_number: order?.sales_record_number ?? r.orderId,
          order_number: r.orderId,
          buyer_username: order?.buyer_username ?? null,
          // Prefer the order's title (clean UTF-8 from the Orders API); fall back to
          // the report's item name (decoded from Windows-1252 in the client).
          item_title: order?.item_title || r.itemName || null,
          reason: r.reason ? r.reason.replace(/_/g, ' ') : 'Return requested',
          status: 'pending',
          notes: r.status ? `Amazon status: ${r.status}` : '',
          returned_at: returnedAt,
          metadata: { platform: 'amazon', amazon_return_id: returnKey(r), amazon_rma_id: r.rmaId, asin: r.asin, sku: r.sku, order_matched: !!order },
        };
      });

    if (toInsert.length > 0) {
      // Upsert on id so re-syncs never fail on a row we already created.
      const { error: insertError } = await supabase.from('returns').upsert(toInsert, { onConflict: 'id' });
      if (insertError) {
        return NextResponse.json({ error: 'store_failed', parsed: returns.length, message: insertError.message }, { status: 500 });
      }
    }

    const matched = toInsert.filter((r) => r.order_id).length;
    return NextResponse.json({ synced: returns.length, created: toInsert.length, matched, unmatched: toInsert.length - matched });
  } catch (err) {
    return NextResponse.json(
      { error: 'sync_failed', message: err instanceof Error ? err.message : 'unknown error' },
      { status: 502 },
    );
  }
}
