import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ANALYTICS_BASE = 'https://api.ebay.com/sell/analytics/v1';
const FINANCES_BASE = 'https://api.ebay.com/sell/finances/v1';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const ANALYTICS_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly';
const FINANCES_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.finances';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
async function getSetting(key: string): Promise<string | null> {
  const { data } = await getSupabase().from('app_settings').select('value').eq('key', key).single();
  return data?.value ?? null;
}

// Scoped user token minted from the refresh token (needs that scope granted at auth).
async function getScopedToken(scope: string, cacheKey: string): Promise<string | null> {
  const supabase = getSupabase();
  const refreshToken = process.env.EBAY_REFRESH_TOKEN ?? (await getSetting('ebay_refresh_token'));
  if (!refreshToken) return null;
  const at = await getSetting(`${cacheKey}`);
  const exp = Number((await getSetting(`${cacheKey}_expires_at`)) ?? 0);
  if (at && Date.now() < exp - 5 * 60 * 1000) return at;

  const creds = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope }),
  });
  if (!res.ok) { console.warn(`[eBay metrics] ${cacheKey} failed (needs re-auth with scope)`, res.status); return null; }
  const data = await res.json() as { access_token: string; expires_in: number };
  await supabase.from('app_settings').upsert([
    { key: cacheKey, value: data.access_token, updated_at: new Date().toISOString() },
    { key: `${cacheKey}_expires_at`, value: String(Date.now() + data.expires_in * 1000), updated_at: new Date().toISOString() },
  ]);
  return data.access_token;
}
const getAnalyticsToken = () => getScopedToken(ANALYTICS_SCOPE, 'ebay_analytics_token');
const getFinancesToken = () => getScopedToken(FINANCES_SCOPE, 'ebay_finances_token');

function dayRange(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86400000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// GET /api/ebay/metrics?date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  const dateStr = new URL(req.url).searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const today = dayRange(dateStr);
  const yStart = new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() - 86400000);
  const yesterday = { start: yStart.toISOString(), end: today.start };

  // ---- DB-derived figures (reliable, from our own data) ----
  const [ordersRes, refundsRes, returnsTodayRes, returnsYestRes, negTodayRes, negYestRes] = await Promise.all([
    supabase.from('orders').select('total_price').gte('sale_date', today.start).lt('sale_date', today.end),
    supabase.from('returns').select('metadata,refund_amount,status').gte('returned_at', today.start).lt('returned_at', today.end),
    supabase.from('returns').select('id', { count: 'exact', head: true }).gte('returned_at', today.start).lt('returned_at', today.end),
    supabase.from('returns').select('id', { count: 'exact', head: true }).gte('returned_at', yesterday.start).lt('returned_at', yesterday.end),
    supabase.from('ebay_feedback').select('feedback_id', { count: 'exact', head: true }).eq('comment_type', 'NEGATIVE').gte('first_seen_at', today.start).lt('first_seen_at', today.end),
    supabase.from('ebay_feedback').select('feedback_id', { count: 'exact', head: true }).eq('comment_type', 'NEGATIVE').gte('first_seen_at', yesterday.start).lt('first_seen_at', yesterday.end),
  ]);

  const orders = ordersRes.data ?? [];
  const grossSale = orders.reduce((s, o) => s + (Number(o.total_price) || 0), 0);
  const refundsIssued = (refundsRes.data ?? []).reduce((s, r) => s + (Number(r.refund_amount) || 0), 0);

  const db = {
    date: dateStr,
    grossSale,
    totalOrders: orders.length,
    refundsIssued,
    netEstimate: grossSale - refundsIssued,
    returnsOpenedToday: returnsTodayRes.count ?? 0,
    returnsOpenedYesterday: returnsYestRes.count ?? 0,
    negativeFeedbackToday: negTodayRes.count ?? 0,
    negativeFeedbackYesterday: negYestRes.count ?? 0,
  };

  // ---- eBay Analytics (needs the sell.analytics.readonly scope; graceful if absent) ----
  const performance: Record<string, number | string | null> = {
    transactionDefectRate: null, lateShipmentRate: null,
    itemNotAsDescribedRate: null, itemNotReceivedRate: null,
    itemNotAsDescribedProjected: null, itemNotReceivedProjected: null,
  };
  let analyticsAvailable = false;

  const token = await getAnalyticsToken();
  if (token) {
    const headers = { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json' };
    try {
      // Seller standards profile → transaction defect rate, late shipment rate.
      const sp = await fetch(`${ANALYTICS_BASE}/seller_standards_profile`, { headers });
      if (sp.ok) {
        analyticsAvailable = true;
        const data = await sp.json() as { standardsProfiles?: { metrics?: { metricKey?: string; value?: { value?: string | number } }[] }[] };
        const metrics = data.standardsProfiles?.flatMap((p) => p.metrics ?? []) ?? [];
        const find = (k: string) => metrics.find((m) => m.metricKey === k)?.value?.value;
        performance.transactionDefectRate = (find('TRANSACTION_DEFECT_RATE') as number | undefined) ?? null;
        performance.lateShipmentRate = (find('SHIPPING_MISS_RATE') as number | undefined) ?? (find('LATE_SHIPMENT_RATE') as number | undefined) ?? null;
      }
      // Customer service metrics → INAD (returns) and INR (disputes) rates.
      for (const [type, key, projKey] of [
        ['ITEM_NOT_AS_DESCRIBED', 'itemNotAsDescribedRate', 'itemNotAsDescribedProjected'],
        ['ITEM_NOT_RECEIVED', 'itemNotReceivedRate', 'itemNotReceivedProjected'],
      ] as const) {
        const m = await fetch(`${ANALYTICS_BASE}/customer_service_metric/${type}/CURRENT?evaluation_marketplace_id=EBAY_GB`, { headers });
        if (m.ok) {
          analyticsAvailable = true;
          const d = await m.json() as { metricValue?: string | number; peerBenchmark?: { metricValue?: string | number } };
          performance[key] = (d.metricValue as number | undefined) ?? null;
          performance[projKey] = (d.peerBenchmark?.metricValue as number | undefined) ?? null;
        }
      }
    } catch (e) {
      console.warn('[eBay metrics] analytics fetch error', e);
    }
  }

  // ---- eBay Finances (real fees + net payout; needs sell.finances scope) ----
  let ebayFees: number | null = null;
  let financesAvailable = false;
  const finToken = await getFinancesToken();
  if (finToken) {
    try {
      const filter = `transactionDate:[${today.start}..${today.end}]`;
      const fr = await fetch(`${FINANCES_BASE}/transaction_summary?filter=${encodeURIComponent(filter)}`, {
        headers: { Authorization: `Bearer ${finToken}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json' },
      });
      if (fr.ok) {
        financesAvailable = true;
        const d = await fr.json() as { totalFeeAmount?: { value?: string | number } };
        if (d.totalFeeAmount?.value != null) ebayFees = Number(d.totalFeeAmount.value);
      }
    } catch (e) { console.warn('[eBay metrics] finances fetch error', e); }
  }

  const netPayout = ebayFees != null ? db.grossSale - db.refundsIssued - ebayFees : db.netEstimate;

  return NextResponse.json({
    ...db,
    ebayFees,
    netPayout,
    performance,
    analyticsAvailable,
    financesAvailable,
    analyticsHint: (analyticsAvailable && financesAvailable) ? null : 'Reconnect eBay (Import Orders → Connect eBay Account) to enable performance & finance metrics.',
  });
}
