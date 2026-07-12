'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BarChart3, RefreshCw, AlertTriangle, PoundSterling, ShoppingCart, RotateCcw, ThumbsDown, Gauge, PackageCheck, Clock, WifiOff, Megaphone } from 'lucide-react';
import type { PlatformMetrics } from '@/app/api/platform-metrics/route';

interface EbayMetrics {
  date: string;
  grossSale: number;
  totalOrders: number;
  refundsIssued: number;
  netEstimate: number;
  ebayFees: number | null;
  ebayAdSpend: number | null;
  netPayout: number;
  financesAvailable: boolean;
  returnsOpenedToday: number;
  returnsOpenedYesterday: number;
  negativeFeedbackToday: number;
  negativeFeedbackYesterday: number;
  performance: {
    transactionDefectRate: number | string | null;
    lateShipmentRate: number | string | null;
    itemNotAsDescribedRate: number | string | null;
    itemNotReceivedRate: number | string | null;
    itemNotAsDescribedProjected: number | string | null;
    itemNotReceivedProjected: number | string | null;
  };
  analyticsAvailable: boolean;
  financesNeedsSignature: boolean;
  analyticsHint: string | null;
  salesSource?: 'ebay' | 'local';
}

interface PlatformResponse {
  date: string;
  platforms: PlatformMetrics[];
}

interface AmazonMetrics {
  date: string;
  grossSale: number;
  totalOrders: number;
  refundsIssued: number;
  fees: number | null;
  promotions: number | null;
  netPayout: number;
  financesAvailable: boolean;
  currency: string;
  salesSource: 'amazon' | 'local';
  hint: string | null;
  adSpend: number | null;
  adSpendPeriod: string | null;
}

const PLATFORM_TABS = [
  { id: 'ebay',        label: 'eBay',        logo: '/ebay.png',        ext: false },
  { id: 'backmarket',  label: 'Back Market', logo: '/backmarket.svg',  ext: false },
  { id: 'amazon',      label: 'Amazon',      logo: '/amazon.png',      ext: false },
  { id: 'onbuy',       label: 'OnBuy',       logo: '/onbuy.svg',       ext: false },
  { id: 'temu',        label: 'Temu',        logo: '/Temu.png',        ext: false },
] as const;

type TabId = typeof PLATFORM_TABS[number]['id'];

const SYMBOLS: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' };
const money = (n: number, currency = 'GBP') => {
  const sym = SYMBOLS[currency] ?? '£';
  return `${sym}${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const pct = (v: number | string | null) => (v == null || v === '') ? '—' : `${v}%`;

function Stat({ label, value, sub, icon: Icon, tone = 'slate' }: { label: string; value: string; sub?: string; icon: typeof PoundSterling; tone?: string }) {
  const tones: Record<string, string> = {
    slate: 'text-slate-800', green: 'text-green-700', red: 'text-red-600', blue: 'text-blue-700', amber: 'text-amber-700',
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><Icon className="h-3.5 w-3.5" /> {label}</div>
      <p className={`text-2xl font-bold mt-1 ${tones[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function PlatformTabContent({ p }: { p: PlatformMetrics }) {
  if (!p.connected) {
    return (
      <div className="py-16 text-center text-slate-400 space-y-2">
        <WifiOff className="h-8 w-8 mx-auto" />
        <p className="font-medium text-slate-600">{p.label} not connected</p>
        <p className="text-sm">Configure credentials in your environment to enable live metrics.</p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${p.dataSource === 'live' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
          {p.dataSource === 'live' ? '● live from API' : '○ local imported data'}
        </span>
      </div>

      {p.error && (
        <div className="flex items-start gap-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{p.error}</span>
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Sales</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Gross Sale" value={money(p.grossSale, p.currency)} icon={PoundSterling} tone="green" />
          <Stat label="Total Orders" value={p.totalOrders.toLocaleString()} icon={ShoppingCart} tone="blue" />
          <Stat label="Pending" value={p.pendingOrders.toLocaleString()} icon={Clock} tone="amber" />
          <Stat label="Shipped" value={p.shippedOrders.toLocaleString()} icon={PackageCheck} tone="slate" />
        </div>
      </div>

      {p.refundsIssued > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Refunds</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Refunds Issued" value={money(p.refundsIssued, p.currency)} icon={RotateCcw} tone="red" />
            <Stat label="Net Estimate" value={money(p.netEstimate, p.currency)} icon={PoundSterling} tone="green" />
          </div>
        </div>
      )}
    </div>
  );
}

export function OverviewDashboard() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState<TabId>('ebay');
  const [ebay, setEbay] = useState<EbayMetrics | null>(null);
  const [platforms, setPlatforms] = useState<PlatformMetrics[]>([]);
  const [amazon, setAmazon] = useState<AmazonMetrics | null>(null);
  const [ebayLoading, setEbayLoading] = useState(false);
  const [platformsLoading, setPlatformsLoading] = useState(false);
  const [amazonLoading, setAmazonLoading] = useState(false);

  const loadEbay = useCallback(async () => {
    setEbayLoading(true);
    try {
      const res = await fetch(`/api/ebay/metrics?date=${date}`);
      if (res.ok) setEbay(await res.json() as EbayMetrics);
    } finally {
      setEbayLoading(false);
    }
  }, [date]);

  const loadPlatforms = useCallback(async () => {
    setPlatformsLoading(true);
    try {
      const res = await fetch(`/api/platform-metrics?date=${date}`);
      if (res.ok) {
        const data = await res.json() as PlatformResponse;
        setPlatforms(data.platforms);
      }
    } finally {
      setPlatformsLoading(false);
    }
  }, [date]);

  const loadAmazon = useCallback(async () => {
    setAmazonLoading(true);
    try {
      const res = await fetch(`/api/amazon/metrics?date=${date}`);
      if (res.ok) setAmazon(await res.json() as AmazonMetrics);
    } finally {
      setAmazonLoading(false);
    }
  }, [date]);

  useEffect(() => { loadEbay(); }, [loadEbay]);
  useEffect(() => { loadPlatforms(); }, [loadPlatforms]);
  useEffect(() => { loadAmazon(); }, [loadAmazon]);

  const isLoading = tab === 'ebay' ? ebayLoading : tab === 'amazon' ? amazonLoading : platformsLoading;
  const refresh = tab === 'ebay' ? loadEbay : tab === 'amazon' ? loadAmazon : loadPlatforms;
  const currentPlatform = platforms.find((p) => p.source === tab);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><BarChart3 className="h-6 w-6 text-blue-500" /> Overview</h2>
          <p className="text-slate-500 text-sm mt-1">Sales, service &amp; performance metrics.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          <Button variant="outline" onClick={refresh} disabled={isLoading}><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /></Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 border-b border-slate-200 overflow-x-auto">
        {PLATFORM_TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors shrink-0
                ${active ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
            >
              <Image src={t.logo} alt={t.label} width={20} height={20} className="object-contain rounded-sm" style={{ maxHeight: 20 }} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Loading spinner (shown when switching tabs before data arrives) */}
      {isLoading && tab === 'ebay' && !ebay && (
        <div className="py-16 text-center text-slate-400"><RefreshCw className="h-6 w-6 mx-auto animate-spin mb-2" /><p className="text-sm">Loading…</p></div>
      )}
      {amazonLoading && tab === 'amazon' && !amazon && (
        <div className="py-16 text-center text-slate-400"><RefreshCw className="h-6 w-6 mx-auto animate-spin mb-2" /><p className="text-sm">Loading…</p></div>
      )}
      {isLoading && tab !== 'ebay' && tab !== 'amazon' && platforms.length === 0 && (
        <div className="py-16 text-center text-slate-400"><RefreshCw className="h-6 w-6 mx-auto animate-spin mb-2" /><p className="text-sm">Loading…</p></div>
      )}

      {/* eBay tab content */}
      {tab === 'ebay' && ebay && (
        <>
          {/* Sales */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Sales · {ebay.date}
              {ebay.salesSource === 'ebay' && <span className="ml-2 font-normal text-slate-400 normal-case">· live from eBay Finances</span>}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <Stat label="Gross Sale" value={money(ebay.grossSale)} icon={PoundSterling} tone="green" />
              <Stat label="Total Orders" value={ebay.totalOrders.toLocaleString()} icon={ShoppingCart} tone="blue" />
              <Stat label="Refunds Issued" value={money(ebay.refundsIssued)} icon={RotateCcw} tone="red" />
              <Stat label="eBay Selling Cost" value={ebay.ebayFees != null ? money(ebay.ebayFees) : '—'} sub={ebay.ebayFees == null ? (ebay.financesNeedsSignature ? 'needs API signature' : 'unavailable') : 'fees'} icon={PoundSterling} tone="amber" />
              <Stat label="Ad Spend" value={ebay.ebayAdSpend != null ? money(ebay.ebayAdSpend) : '—'} sub={ebay.ebayAdSpend == null ? 'unavailable' : 'Promoted Listings'} icon={Megaphone} tone="amber" />
              <Stat label="Net Payout" value={money(ebay.netPayout)} sub={ebay.financesAvailable ? 'gross − refunds − fees − ads' : 'gross − refunds (est.)'} icon={PoundSterling} tone="green" />
            </div>
          </div>

          {/* Service */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Service</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Returns Opened (yesterday)" value={String(ebay.returnsOpenedYesterday)} sub={`${ebay.returnsOpenedToday} today`} icon={RotateCcw} tone="amber" />
              <Stat label="Negative Fdbk (yesterday)" value={String(ebay.negativeFeedbackYesterday)} sub={`${ebay.negativeFeedbackToday} today`} icon={ThumbsDown} tone={ebay.negativeFeedbackYesterday > 0 ? 'red' : 'slate'} />
            </div>
          </div>

          {/* eBay performance */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-2"><Gauge className="h-3.5 w-3.5" /> eBay Performance</h3>
            {ebay.analyticsHint && (
              <div className="mb-3 flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{ebay.analyticsHint}</span>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Transaction Defect Rate" value={pct(ebay.performance.transactionDefectRate)} icon={Gauge} />
              <Stat label="Late Delivery Rate" value={pct(ebay.performance.lateShipmentRate)} icon={Gauge} />
              <Stat label="Return Rate — Item not described" value={pct(ebay.performance.itemNotAsDescribedRate)} sub={`Projected ${pct(ebay.performance.itemNotAsDescribedProjected)}`} icon={Gauge} tone="amber" />
              <Stat label="Dispute Rate — Item not received" value={pct(ebay.performance.itemNotReceivedRate)} sub={`Projected ${pct(ebay.performance.itemNotReceivedProjected)}`} icon={Gauge} tone="amber" />
            </div>
          </div>
        </>
      )}

      {/* Amazon tab — rich metrics from SP-API Finances */}
      {tab === 'amazon' && amazon && (
        <>
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Sales · {amazon.date}
              {amazon.salesSource === 'amazon' && <span className="ml-2 font-normal text-slate-400 normal-case">· live from Amazon Finances</span>}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <Stat label="Gross Sale" value={money(amazon.grossSale, amazon.currency)} icon={PoundSterling} tone="green" />
              <Stat label="Total Orders" value={amazon.totalOrders.toLocaleString()} icon={ShoppingCart} tone="blue" />
              <Stat label="Refunds" value={money(amazon.refundsIssued, amazon.currency)} icon={RotateCcw} tone="red" />
              <Stat label="Amazon Fees" value={amazon.fees != null ? money(amazon.fees, amazon.currency) : '—'} sub={amazon.fees == null ? 'unavailable' : 'referral + FBA'} icon={PoundSterling} tone="amber" />
              <Stat label="Net Payout" value={money(amazon.netPayout, amazon.currency)} sub={amazon.financesAvailable ? 'gross − fees − refunds' : 'gross − refunds (est.)'} icon={PoundSterling} tone="green" />
            </div>
          </div>

          {/* Advertising — lagging per-settlement total, not tied to the picked date */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Advertising</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat
                label="Ad Spend (last settlement)"
                value={amazon.adSpend != null ? money(amazon.adSpend, amazon.currency) : '—'}
                sub={amazon.adSpend != null ? (amazon.adSpendPeriod ?? 'latest settlement') : 'no settlement report yet'}
                icon={Megaphone}
                tone="amber"
              />
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Total &quot;Cost of Advertising&quot; from Amazon&apos;s latest settlement (~2-week period). Daily PPC breakdown needs the Amazon Advertising API.
            </p>
          </div>

          {amazon.hint && (
            <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{amazon.hint}</span>
            </div>
          )}
        </>
      )}

      {/* Temu: no API integration yet — placeholder */}
      {tab === 'temu' && (
        <div className="py-16 text-center text-slate-400 space-y-2">
          <WifiOff className="h-8 w-8 mx-auto" />
          <p className="font-medium text-slate-600">Temu API not yet integrated</p>
          <p className="text-sm">Temu does not currently provide a seller API. Orders can be imported via CSV.</p>
        </div>
      )}

      {/* BackMarket / OnBuy */}
      {tab !== 'ebay' && tab !== 'temu' && tab !== 'amazon' && (
        currentPlatform
          ? <PlatformTabContent p={currentPlatform} />
          : (!platformsLoading && <div className="py-12 text-center text-slate-400 text-sm">No data available.</div>)
      )}
    </div>
  );
}
