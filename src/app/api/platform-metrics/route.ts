import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isBackmarketConfigured, fetchBackmarketOrders } from '@/lib/backmarket-api';
import { isAmazonConfigured, getAmazonAccessToken, fetchAmazonOrders, AmazonOrder } from '@/lib/amazon-client';
import { isOnBuyConfigured, getOnBuyCredentials, fetchOnBuyOrders, OnBuyOrder } from '@/lib/onbuy-client';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

export interface PlatformMetrics {
  source: string;
  label: string;
  connected: boolean;
  grossSale: number;
  totalOrders: number;
  refundsIssued: number;
  netEstimate: number;
  pendingOrders: number;
  shippedOrders: number;
  dataSource: 'live' | 'local';
  currency: string;
  error?: string;
}

type PartialMetrics = Omit<PlatformMetrics, 'source' | 'label'>;
const BASE: PartialMetrics = { connected: false, grossSale: 0, totalOrders: 0, refundsIssued: 0, netEstimate: 0, pendingOrders: 0, shippedOrders: 0, dataSource: 'local', currency: 'GBP' };

// BackMarket: fetch orders for the day from their API
async function backmarketMetrics(dateStr: string): Promise<PartialMetrics> {
  if (!isBackmarketConfigured()) return { ...BASE };
  try {
    const data = await fetchBackmarketOrders({ date_creation: `${dateStr}T00:00:00.000Z`, pageSize: 100 });
    const results = (data.results ?? []).filter((o) => (o.date_creation ?? '').slice(0, 10) === dateStr);
    const gross = results.reduce((s, o) => s + parseFloat(o.price ?? '0'), 0);
    // BackMarket en-gb endpoint returns prices in GBP regardless of the
    // currency field on the order object (which may say EUR from the FR base URL).
    const countryCode = (process.env.BACKMARKET_COUNTRY_CODE || '').toLowerCase();
    const currency = countryCode === 'en-gb' ? 'GBP' : (results[0]?.currency ?? 'GBP');
    return {
      connected: true,
      grossSale: Math.round(gross * 100) / 100,
      totalOrders: results.length,
      refundsIssued: 0,
      netEstimate: Math.round(gross * 100) / 100,
      // BackMarket state 9 = shipped, 4 = cancelled/refunded
      pendingOrders: results.filter((o) => (o.state ?? 0) < 9 && o.state !== 4).length,
      shippedOrders: results.filter((o) => o.state === 9).length,
      dataSource: 'live',
      currency,
    };
  } catch (e) {
    return { ...BASE, connected: true, dataSource: 'live', error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

// Amazon: fetch orders created on that date via SP-API
async function amazonMetrics(dateStr: string): Promise<PartialMetrics> {
  if (!isAmazonConfigured()) return { ...BASE };
  try {
    const token = await getAmazonAccessToken();
    const payload = await fetchAmazonOrders({ token, createdAfter: `${dateStr}T00:00:00Z` });
    const rawOrders: AmazonOrder[] = payload.Orders ?? [];
    // filter to exact calendar day
    const todayOrders = rawOrders.filter((o) => (o.PurchaseDate ?? '').slice(0, 10) === dateStr);
    const gross = todayOrders.reduce((s, o) => s + parseFloat(String(o.OrderTotal?.Amount ?? '0')), 0);
    const currency = todayOrders[0]?.OrderTotal?.CurrencyCode ?? 'GBP';
    return {
      connected: true,
      grossSale: Math.round(gross * 100) / 100,
      totalOrders: todayOrders.length,
      refundsIssued: 0,
      netEstimate: Math.round(gross * 100) / 100,
      pendingOrders: todayOrders.filter((o) => o.OrderStatus === 'Pending' || o.OrderStatus === 'Unshipped').length,
      shippedOrders: todayOrders.filter((o) => o.OrderStatus === 'Shipped').length,
      dataSource: 'live',
      currency,
    };
  } catch (e) {
    return { ...BASE, connected: true, dataSource: 'live', error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

// OnBuy: fetch orders for the day.
// OnBuy has no filter[created_since] param — only filter[modified_since].
// We fetch the last 7 days (sorted newest first) and filter client-side by
// o.date (creation timestamp "YYYY-MM-DD HH:MM:SS"). Paginate until we've
// passed the target date or exhausted results.
async function onbuyMetrics(dateStr: string): Promise<PartialMetrics> {
  const creds = getOnBuyCredentials();
  if (!isOnBuyConfigured() || !creds) return { ...BASE };
  try {
    const limit = 50;
    let offset = 0;
    const matched: OnBuyOrder[] = [];
    // No date filter — OnBuy's modifiedSince returns 0 for today. Fetch latest
    // orders and filter client-side by creation date (o.date "YYYY-MM-DD HH:MM:SS").
    // Stop once we see orders older than the target date (API returns newest first by default).
    let done = false;
    for (let page = 0; page < 5 && !done; page++) {
      const res = await fetchOnBuyOrders({ siteId: creds.siteId, limit, offset });
      const rows = res.results ?? [];

      if (rows.length === 0) break;
      for (const o of rows) {
        const created = (o.date ?? '').slice(0, 10);
        if (created === dateStr) matched.push(o);
        else if (created < dateStr) { done = true; break; }
      }
      const total = res.metadata?.total_rows ?? rows.length;
      offset += limit;
      if (rows.length < limit || offset >= total) break;
    }
    const gross = matched.reduce((s, o) => s + parseFloat(String(o.price_total ?? '0')), 0);
    return {
      connected: true,
      grossSale: Math.round(gross * 100) / 100,
      totalOrders: matched.length,
      refundsIssued: 0,
      netEstimate: Math.round(gross * 100) / 100,
      pendingOrders: matched.filter((o) => !o.dispatched && (o.status ?? '').toLowerCase() !== 'cancelled').length,
      shippedOrders: matched.filter((o) => !!o.dispatched || !!o.shipped_at).length,
      dataSource: 'live',
      currency: 'GBP',
    };
  } catch (e) {
    return { ...BASE, connected: true, dataSource: 'live', error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

// Local DB fallback: aggregate from imported orders for a given source and date
async function localMetrics(source: string, dateStr: string): Promise<{ grossSale: number; totalOrders: number; pendingOrders: number; shippedOrders: number }> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('orders')
    .select('total_price, status')
    .eq('batch_source', source)
    .gte('sale_date', `${dateStr}T00:00:00.000Z`)
    .lt('sale_date', `${dateStr}T23:59:59.999Z`);
  const rows = (data ?? []) as { total_price: string | number | null; status: string | null }[];
  return {
    grossSale: Math.round(rows.reduce((s, o) => s + (Number(o.total_price) || 0), 0) * 100) / 100,
    totalOrders: rows.length,
    pendingOrders: rows.filter((o) => o.status === 'pending').length,
    shippedOrders: rows.filter((o) => o.status === 'shipped').length,
  };
}

// GET /api/platform-metrics?date=YYYY-MM-DD
// Returns metrics for all configured platforms.
export async function GET(req: NextRequest) {
  const dateStr = new URL(req.url).searchParams.get('date') || new Date().toISOString().slice(0, 10);

  const [bm, amz, onbuy] = await Promise.all([
    backmarketMetrics(dateStr),
    amazonMetrics(dateStr),
    onbuyMetrics(dateStr),
  ]);

  // For platforms where live fetch returned 0 orders, supplement with local DB data
  const [bmLocal, amzLocal, onbuyLocal] = await Promise.all([
    bm.totalOrders === 0 ? localMetrics('backmarket', dateStr) : Promise.resolve(null),
    amz.totalOrders === 0 ? localMetrics('amazon', dateStr) : Promise.resolve(null),
    onbuy.totalOrders === 0 ? localMetrics('onbuy', dateStr) : Promise.resolve(null),
  ]);

  const platforms: PlatformMetrics[] = [
    {
      source: 'backmarket', label: 'Back Market',
      ...bm,
      ...(bmLocal && bm.totalOrders === 0 ? { ...bmLocal, dataSource: 'local' as const } : {}),
    },
    {
      source: 'amazon', label: 'Amazon',
      ...amz,
      ...(amzLocal && amz.totalOrders === 0 ? { ...amzLocal, dataSource: 'local' as const } : {}),
    },
    {
      source: 'onbuy', label: 'OnBuy',
      ...onbuy,
      ...(onbuyLocal && onbuy.totalOrders === 0 ? { ...onbuyLocal, dataSource: 'local' as const } : {}),
    },
  ];

  return NextResponse.json({ date: dateStr, platforms });
}
