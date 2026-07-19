import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-admin';
import { signEbayRequest } from '@/lib/ebay-signature';

const ANALYTICS_BASE = 'https://api.ebay.com/sell/analytics/v1';
// Finances is a signature-required API, served from the apiz host.
const FINANCES_BASE = 'https://apiz.ebay.com/sell/finances/v1';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const ANALYTICS_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly';
const FINANCES_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.finances';

function getSupabase() {
  return getServiceClient();
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
  // Debug passthrough exposes raw eBay responses, so require an explicit env flag
  // as well as the query param — this endpoint is unauthenticated.
  const debug = new URL(req.url).searchParams.get('debug') === '1' && process.env.EBAY_METRICS_DEBUG === '1';
  const debugRaw: Record<string, unknown> = {};

  // A getCustomerServiceMetric response breaks the seller's rate down per
  // dimension (listing category for INAD, shipping region for INR). Each slice
  // carries RATE, COUNT (claims) and TRANSACTION_COUNT metrics. The headline
  // figure is the OVERALL rate = Σcount / Σtransactions — NOT the worst slice
  // (a tiny category with 2 claims out of 17 sales showed as "11.76%" while the
  // real overall rate was ~4%). Falls back to the worst slice rate only when
  // eBay omits the counts. Returns null when eBay has no data (empty, or 54200).
  interface SspMetric { metricKey?: string; name?: string; value?: { value?: string | number } }
  interface CsmResponse { dimensionMetrics?: { metrics?: { metricKey?: string; value?: string | number }[] }[] }
  const csmOverallRate = (d: CsmResponse): string | number | null => {
    let claims = 0;
    let transactions = 0;
    let haveCounts = false;
    let worst: number | null = null;
    let worstRaw: string | number | null = null;
    for (const dm of d.dimensionMetrics ?? []) {
      let sliceClaims: number | null = null;
      let sliceTx: number | null = null;
      for (const mm of dm.metrics ?? []) {
        if (mm.value == null) continue;
        const n = Number(mm.value);
        if (!Number.isFinite(n)) continue;
        if (mm.metricKey === 'COUNT') sliceClaims = n;
        else if (mm.metricKey === 'TRANSACTION_COUNT') sliceTx = n;
        else if (mm.metricKey === 'RATE' && (worst == null || n > worst)) { worst = n; worstRaw = mm.value; }
      }
      if (sliceClaims != null && sliceTx != null) {
        haveCounts = true;
        claims += sliceClaims;
        transactions += sliceTx;
      }
    }
    if (haveCounts && transactions > 0) return Number(((claims / transactions) * 100).toFixed(2));
    return worstRaw;
  };

  const token = await getAnalyticsToken();
  if (token) {
    const headers = { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json' };
    try {
      // Seller standards profile → transaction defect rate, late shipment rate.
      // Match by known metricKey, falling back to the human-readable name since
      // eBay's exact key abbreviations aren't guaranteed across programs.
      const sp = await fetch(`${ANALYTICS_BASE}/seller_standards_profile`, { headers });
      if (sp.ok) {
        analyticsAvailable = true;
        const data = await sp.json() as { standardsProfiles?: { metrics?: SspMetric[] }[] };
        if (debug) debugRaw.sellerStandardsProfile = data;
        const metrics = data.standardsProfiles?.flatMap((p) => p.metrics ?? []) ?? [];
        const findValue = (pred: (m: SspMetric) => boolean) => metrics.find(pred)?.value?.value ?? null;
        performance.transactionDefectRate = findValue((m) =>
          m.metricKey === 'DEFECTIVE_TRANSACTION_RATE' ||
          m.metricKey === 'TRANSACTION_DEFECT_RATE' ||
          (m.name ?? '').toLowerCase().includes('defect'));
        performance.lateShipmentRate = findValue((m) =>
          m.metricKey === 'SHIPPING_MISS_RATE' ||
          m.metricKey === 'LATE_SHIPMENT_RATE' ||
          (m.name ?? '').toLowerCase().includes('late'));
      } else if (debug) {
        debugRaw.sellerStandardsProfileError = { status: sp.status, body: await sp.text() };
      }
      // Customer service metrics → INAD (returns) and INR (disputes). CURRENT is
      // the headline rate; PROJECTED is the trend toward the next evaluation.
      for (const [type, key, projKey] of [
        ['ITEM_NOT_AS_DESCRIBED', 'itemNotAsDescribedRate', 'itemNotAsDescribedProjected'],
        ['ITEM_NOT_RECEIVED', 'itemNotReceivedRate', 'itemNotReceivedProjected'],
      ] as const) {
        for (const [evalType, field] of [['CURRENT', key], ['PROJECTED', projKey]] as const) {
          const m = await fetch(`${ANALYTICS_BASE}/customer_service_metric/${type}/${evalType}?evaluation_marketplace_id=EBAY_GB`, { headers });
          if (m.ok) {
            analyticsAvailable = true;
            const d = await m.json() as CsmResponse;
            if (debug) debugRaw[`csm_${type}_${evalType}`] = d;
            performance[field] = csmOverallRate(d);
          } else if (debug) {
            debugRaw[`csm_${type}_${evalType}_error`] = { status: m.status, body: await m.text() };
          }
        }
      }
    } catch (e) {
      console.warn('[eBay metrics] analytics fetch error', e);
      if (debug) debugRaw.analyticsException = String(e);
    }
  } else if (debug) {
    debugRaw.analyticsToken = 'null — sell.analytics.readonly scope not granted on refresh token';
  }

  // ---- eBay Finances (real fees + net payout) ----
  // eBay's per-order selling fee lives on each SALE transaction (totalFeeAmount);
  // there is no aggregate fee field. Sum totalFeeAmount over the day's SALE
  // transactions. The Finances API requires an RFC 9421 digital signature.
  let ebayFees: number | null = null;
  let ebayGross: number | null = null;
  let ebayAdSpend: number | null = null;   // total Promoted Listings spend (SALE lines + NON_SALE_CHARGE)
  let ebayAdCharges = 0;                   // the NON_SALE_CHARGE portion — not in ebayFees, so net subtracts it
  let ebayOrderCount: number | null = null;
  let financesAvailable = false;
  let financesNeedsSignature = false;
  const finToken = await getFinancesToken();
  if (finToken) {
    try {
      const filter = `transactionType:{SALE},transactionDate:[${today.start}..${today.end}]`;
      const limit = 200;
      let offset = 0;
      let feeSum = 0;         // sum of totalFeeAmount = selling fees
      let grossSum = 0;       // sum of totalFeeBasisAmount = gross sale value
      let adFeeSum = 0;       // ad fees on SALE lines (already included in feeSum)
      let adChargeSum = 0;    // ad fees billed as NON_SALE_CHARGE (NOT in feeSum)
      const saleOrderIds = new Set<string>();
      let total = Infinity;
      for (let page = 0; offset < total && page < 20; page++) {
        const url = `${FINANCES_BASE}/transaction?filter=${encodeURIComponent(filter)}&limit=${limit}&offset=${offset}`;
        const sig = await signEbayRequest({ method: 'GET', url });
        const fr = await fetch(url, {
          headers: { Authorization: `Bearer ${finToken}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json', ...sig },
        });
        if (!fr.ok) {
          const body = await fr.text();
          if (fr.status === 403 && /signature/i.test(body)) financesNeedsSignature = true;
          if (debug) debugRaw.financesError = { status: fr.status, body: body.slice(0, 400) };
          break;
        }
        financesAvailable = true;
        const d = await fr.json() as {
          total?: number;
          transactions?: {
            orderId?: string;
            totalFeeAmount?: { value?: string | number };
            totalFeeBasisAmount?: { value?: string | number };
            orderLineItems?: { marketplaceFees?: { feeType?: string; amount?: { value?: string | number } }[] }[];
          }[];
        };
        if (debug && page === 0) debugRaw.financesSample = { total: d.total, first: d.transactions?.[0] };
        const txns = d.transactions ?? [];
        for (const t of txns) {
          feeSum += Number(t.totalFeeAmount?.value ?? 0) || 0;
          grossSum += Number(t.totalFeeBasisAmount?.value ?? 0) || 0;
          if (t.orderId) saleOrderIds.add(t.orderId);
          // Promoted Listings fees carry an AD_FEE feeType in the per-line breakdown.
          for (const li of t.orderLineItems ?? []) {
            for (const mf of li.marketplaceFees ?? []) {
              if (/ad|promot/i.test(mf.feeType ?? '')) adFeeSum += Number(mf.amount?.value ?? 0) || 0;
            }
          }
        }
        total = d.total ?? txns.length;
        offset += limit;
        if (txns.length < limit) break;
      }
      // Promoted Listings fees are mostly billed as separate NON_SALE_CHARGE
      // transactions (feeType AD_FEE), not on the SALE lines — include those.
      try {
        const nscFilter = `transactionType:{NON_SALE_CHARGE},transactionDate:[${today.start}..${today.end}]`;
        let nscOffset = 0;
        let nscTotal = Infinity;
        for (let page = 0; nscOffset < nscTotal && page < 20; page++) {
          const url = `${FINANCES_BASE}/transaction?filter=${encodeURIComponent(nscFilter)}&limit=${limit}&offset=${nscOffset}`;
          const sig = await signEbayRequest({ method: 'GET', url });
          const fr = await fetch(url, {
            headers: { Authorization: `Bearer ${finToken}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json', ...sig },
          });
          if (!fr.ok) { if (debug) debugRaw.nonSaleChargeError = { status: fr.status, body: (await fr.text()).slice(0, 400) }; break; }
          const d = await fr.json() as {
            total?: number;
            transactions?: { feeType?: string; bookingEntry?: string; amount?: { value?: string | number } }[];
          };
          if (debug && page === 0) debugRaw.nonSaleChargeSample = { total: d.total, first: d.transactions?.[0] };
          const txns = d.transactions ?? [];
          for (const t of txns) {
            if (!/ad|promot/i.test(t.feeType ?? '')) continue;
            const v = Number(t.amount?.value ?? 0) || 0;
            // DEBITs are charges; CREDITs are ad-fee refunds/adjustments.
            adChargeSum += t.bookingEntry === 'CREDIT' ? -v : v;
          }
          nscTotal = d.total ?? txns.length;
          nscOffset += limit;
          if (txns.length < limit) break;
        }
      } catch (e) { console.warn('[eBay metrics] non-sale-charge fetch error', e); if (debug) debugRaw.nonSaleChargeException = String(e); }

      if (financesAvailable) {
        ebayFees = Math.round(feeSum * 100) / 100;
        ebayGross = Math.round(grossSum * 100) / 100;
        ebayAdCharges = Math.round(adChargeSum * 100) / 100;
        ebayAdSpend = Math.round((adFeeSum + adChargeSum) * 100) / 100;
        ebayOrderCount = saleOrderIds.size;
      }
    } catch (e) { console.warn('[eBay metrics] finances fetch error', e); if (debug) debugRaw.financesException = String(e); }
  } else if (debug) {
    debugRaw.financesToken = 'null — sell.finances scope not granted on refresh token';
  }

  // When Finances is connected, the Sales block is sourced from eBay's own SALE
  // transactions (gross/fees/net) so the figures are consistent and reflect eBay
  // even for days whose orders haven't been imported locally yet. Otherwise fall
  // back to our orders table.
  const displayGross = ebayGross != null ? ebayGross : db.grossSale;
  const displayOrders = ebayOrderCount != null ? ebayOrderCount : db.totalOrders;
  // ebayAdCharges (NON_SALE_CHARGE ad fees) aren't inside ebayFees, so subtract
  // them separately; SALE-line ad fees are already part of ebayFees.
  const netPayout = ebayFees != null
    ? Math.round((displayGross - db.refundsIssued - ebayFees - ebayAdCharges) * 100) / 100
    : db.netEstimate;
  const salesSource = financesAvailable ? 'ebay' : 'local';

  const hints: string[] = [];
  if (!analyticsAvailable) hints.push('Reconnect eBay (Import Orders → Connect eBay Account) to enable performance metrics.');
  if (!financesAvailable) hints.push(financesNeedsSignature
    ? 'eBay fee data is blocked on the Finances API signature — the signing key could not be created or used.'
    : 'Reconnect eBay with the finance permission to show fees & net payout.');

  return NextResponse.json({
    ...db,
    grossSale: displayGross,
    totalOrders: displayOrders,
    salesSource,
    ebayFees,
    ebayAdSpend,
    netPayout,
    performance,
    analyticsAvailable,
    financesAvailable,
    financesNeedsSignature,
    analyticsHint: hints.length ? hints.join(' ') : null,
    ...(debug ? { _debug: debugRaw } : {}),
  });
}
