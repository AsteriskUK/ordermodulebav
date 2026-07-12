import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isAmazonConfigured, fetchAmazonFinanceSummary, fetchLatestSettlementAdSpend, AmazonSettlementAdSpend } from '@/lib/amazon-client';

// GET /api/amazon/metrics?date=YYYY-MM-DD
// Amazon Overview metrics: gross / orders / refunds / fees / net for the day.
// Sales figures prefer SP-API Finances (real posted money); otherwise fall back
// to our imported orders. Fees & net require the Finance role on the SP-API app.

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

// Ad spend comes from the latest settlement report — a large file that changes
// only per disbursement (~2 weeks), so cache the parsed result for 12 hours.
const AD_SPEND_CACHE_KEY = 'amazon_settlement_adspend';
const AD_SPEND_TTL_MS = 12 * 60 * 60 * 1000;

async function getSettlementAdSpendCached(force = false): Promise<AmazonSettlementAdSpend | null> {
  const supabase = getSupabase();
  if (!force) {
    const { data } = await supabase.from('app_settings').select('value').eq('key', AD_SPEND_CACHE_KEY).single();
    if (data?.value) {
      try {
        const cached = JSON.parse(data.value) as { fetchedAt?: number; result?: AmazonSettlementAdSpend | null };
        if (cached.fetchedAt && Date.now() - cached.fetchedAt < AD_SPEND_TTL_MS) return cached.result ?? null;
      } catch { /* refetch */ }
    }
  }
  const result = await fetchLatestSettlementAdSpend().catch((e) => {
    console.warn('[Amazon metrics] settlement ad spend fetch failed:', e);
    return null;
  });
  await supabase.from('app_settings').upsert({
    key: AD_SPEND_CACHE_KEY,
    value: JSON.stringify({ fetchedAt: Date.now(), result }),
    updated_at: new Date().toISOString(),
  });
  return result;
}

function dayRange(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86400000);
  // Finances rejects PostedBefore within the last ~2 minutes / in the future.
  const cappedEnd = new Date(Math.min(end.getTime(), Date.now() - 2 * 60 * 1000));
  return { start: start.toISOString(), end: end.toISOString(), cappedEnd: cappedEnd.toISOString(), endMs: end.getTime() };
}

export async function GET(req: NextRequest) {
  const dateStr = new URL(req.url).searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const { start, end, cappedEnd, endMs } = dayRange(dateStr);
  const supabase = getSupabase();

  // Local DB figures — reliable, and the fallback when Finances isn't available.
  const [ordersRes, refundsRes] = await Promise.all([
    supabase.from('orders').select('total_price').eq('batch_source', 'amazon').gte('sale_date', start).lt('sale_date', end),
    supabase.from('returns').select('refund_amount').eq('metadata->>platform', 'amazon').gte('returned_at', start).lt('returned_at', end),
  ]);
  const localOrders = ordersRes.data ?? [];
  const localGross = Math.round(localOrders.reduce((s, o) => s + (Number(o.total_price) || 0), 0) * 100) / 100;
  const localRefunds = Math.round((refundsRes.data ?? []).reduce((s, r) => s + (Number(r.refund_amount) || 0), 0) * 100) / 100;

  const base = {
    date: dateStr,
    grossSale: localGross,
    totalOrders: localOrders.length,
    refundsIssued: localRefunds,
    fees: null as number | null,
    promotions: null as number | null,
    netPayout: localGross - localRefunds,
    financesAvailable: false,
    currency: 'GBP',
    salesSource: 'local' as 'local' | 'amazon',
    hint: null as string | null,
  };

  if (!isAmazonConfigured()) {
    return NextResponse.json({ ...base, adSpend: null, adSpendPeriod: null, hint: 'Amazon SP-API credentials not configured.' });
  }

  // Lagging per-settlement total (not tied to the picked date) — see cache note.
  const forceAds = new URL(req.url).searchParams.get('refreshAds') === '1';
  const settlement = await getSettlementAdSpendCached(forceAds);
  const adFields = {
    adSpend: settlement?.adSpend ?? null,
    adSpendPeriod: settlement?.periodStart
      ? `${settlement.periodStart.slice(0, 10)} → ${settlement.periodEnd?.slice(0, 10) ?? '…'}`
      : null,
  };

  // Nothing to post yet for a future/just-started day.
  if (Date.parse(cappedEnd) <= Date.parse(start)) {
    return NextResponse.json({ ...base, ...adFields });
  }

  try {
    const fin = await fetchAmazonFinanceSummary(start, cappedEnd);
    const netPayout = Math.round((fin.gross - fin.fees - fin.refunds - fin.promotions) * 100) / 100;
    return NextResponse.json({
      date: dateStr,
      ...adFields,
      // Prefer Finances gross/orders when it returned data; else keep local.
      grossSale: fin.orderCount > 0 ? fin.gross : localGross,
      totalOrders: fin.orderCount > 0 ? fin.orderCount : localOrders.length,
      refundsIssued: fin.refunds || localRefunds,
      fees: fin.fees,
      promotions: fin.promotions,
      netPayout: fin.orderCount > 0 ? netPayout : base.netPayout,
      financesAvailable: true,
      currency: fin.currency,
      salesSource: fin.orderCount > 0 ? 'amazon' : 'local',
      // Overnight/settlement lag means posted money can trail the order date.
      hint: fin.orderCount === 0 && endMs > Date.now() - 86400000
        ? 'No posted Amazon transactions yet for this day — figures post over the following days.'
        : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    const forbidden = /403|unauthor|access to requested resource is denied|role/i.test(msg);
    return NextResponse.json({
      ...base,
      ...adFields,
      hint: forbidden
        ? 'Amazon fees & net need the "Finance and Accounting" role on the SP-API app — re-authorise with that role granted.'
        : `Amazon finances unavailable: ${msg}`,
    });
  }
}
