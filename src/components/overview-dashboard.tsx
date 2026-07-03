'use client';

import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BarChart3, RefreshCw, AlertTriangle, PoundSterling, ShoppingCart, RotateCcw, ThumbsDown, Gauge } from 'lucide-react';

interface Metrics {
  date: string;
  grossSale: number;
  totalOrders: number;
  refundsIssued: number;
  netEstimate: number;
  ebayFees: number | null;
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
}

const money = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export function OverviewDashboard() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [m, setM] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ebay/metrics?date=${date}`);
      if (res.ok) setM(await res.json() as Metrics);
    } finally {
      setLoading(false);
    }
  }, [date]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><BarChart3 className="h-6 w-6 text-blue-500" /> Overview</h2>
          <p className="text-slate-500 text-sm mt-1">Sales, service &amp; performance metrics.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button>
        </div>
      </div>

      {!m ? (
        <div className="py-16 text-center text-slate-400"><RefreshCw className="h-6 w-6 mx-auto animate-spin mb-2" /><p className="text-sm">Loading…</p></div>
      ) : (
        <>
          {/* Sales */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Sales · {m.date}</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <Stat label="Gross Sale" value={money(m.grossSale)} icon={PoundSterling} tone="green" />
              <Stat label="Total Orders" value={m.totalOrders.toLocaleString()} icon={ShoppingCart} tone="blue" />
              <Stat label="Refunds Issued" value={money(m.refundsIssued)} icon={RotateCcw} tone="red" />
              <Stat label="eBay Selling Cost" value={m.ebayFees != null ? money(m.ebayFees) : '—'} sub={m.ebayFees == null ? (m.financesNeedsSignature ? 'needs API signature' : 'unavailable') : 'fees'} icon={PoundSterling} tone="amber" />
              <Stat label="Net Payout" value={money(m.netPayout)} sub={m.financesAvailable ? 'gross − refunds − fees' : 'gross − refunds (est.)'} icon={PoundSterling} tone="green" />
            </div>
          </div>

          {/* Service */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Service</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Returns Opened (yesterday)" value={String(m.returnsOpenedYesterday)} sub={`${m.returnsOpenedToday} today`} icon={RotateCcw} tone="amber" />
              <Stat label="Negative Fdbk (yesterday)" value={String(m.negativeFeedbackYesterday)} sub={`${m.negativeFeedbackToday} today`} icon={ThumbsDown} tone={m.negativeFeedbackYesterday > 0 ? 'red' : 'slate'} />
            </div>
          </div>

          {/* eBay performance */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-2"><Gauge className="h-3.5 w-3.5" /> eBay Performance</h3>
            {m.analyticsHint && (
              <div className="mb-3 flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{m.analyticsHint}</span>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Transaction Defect Rate" value={pct(m.performance.transactionDefectRate)} icon={Gauge} />
              <Stat label="Late Delivery Rate" value={pct(m.performance.lateShipmentRate)} icon={Gauge} />
              <Stat label="Return Rate — Item not described" value={pct(m.performance.itemNotAsDescribedRate)} sub={`Projected ${pct(m.performance.itemNotAsDescribedProjected)}`} icon={Gauge} tone="amber" />
              <Stat label="Dispute Rate — Item not received" value={pct(m.performance.itemNotReceivedRate)} sub={`Projected ${pct(m.performance.itemNotReceivedProjected)}`} icon={Gauge} tone="amber" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
