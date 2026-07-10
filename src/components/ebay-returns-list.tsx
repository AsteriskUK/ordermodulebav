'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, PackageOpen, ExternalLink, X, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface EbayReturn {
  return_id: string;
  order_id: string | null;
  buyer_login: string | null;
  item_id: string | null;
  item_title: string | null;
  image_url: string | null;
  return_type: string | null;
  reason: string | null;
  reason_type: string | null;
  state: string | null;
  status: string | null;
  refund_amount: number | null;
  currency: string | null;
  creation_date: string | null;
  raw?: Record<string, unknown>;
}

// Not-as-described (SNAD) returns are the seller's problem → red; remorse → amber.
const reasonTone = (t: string | null) =>
  t === 'SNAD' ? 'bg-red-100 text-red-700 border-red-300'
  : t === 'REMORSE' ? 'bg-amber-100 text-amber-700 border-amber-300'
  : 'bg-slate-100 text-slate-600 border-slate-300';

const nice = (s: string | null) => (s ? s.replace(/_/g, ' ').toLowerCase() : '');

export function EbayReturnsList() {
  const [returns, setReturns] = useState<EbayReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [detail, setDetail] = useState<EbayReturn | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ebay/returns');
      if (res.ok) setReturns((await res.json()).returns ?? []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/ebay/returns', { method: 'POST' });
      const data = await res.json();
      if (res.ok) { toast.success(`Synced ${data.synced ?? 0} of ${data.total ?? 0} eBay returns`); await load(); }
      else if (res.status === 401) toast.error('eBay not connected');
      else toast.error(`Returns sync failed: ${data.message || data.error || 'error'}`);
    } catch { toast.error('Returns sync failed'); } finally { setSyncing(false); }
  }, [load]);

  useEffect(() => { load(); sync(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (!detail) return;
    setDetailLoading(true);
    fetch(`/api/ebay/returns/${detail.return_id}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setDetail((prev) => prev ? { ...prev, raw: data.detail ?? prev.raw } : null);
        }
      })
      .catch(() => { /* keep existing raw */ })
      .finally(() => setDetailLoading(false));
  }, [detail?.return_id]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-600 flex items-center gap-1.5">
          <PackageOpen className="h-4 w-4 text-rose-500" /> eBay Returns (buyer-initiated) · {returns.length}
        </h3>
        <button onClick={sync} disabled={syncing} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Syncing…' : 'Sync'}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>
      ) : returns.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center border border-dashed rounded-xl">No eBay returns synced yet.</p>
      ) : (
        <div className="space-y-1.5">
          {returns.map((r) => (
            <div key={r.return_id} onClick={() => setDetail(r)} className="border border-slate-200 rounded-xl bg-white px-3 py-2.5 flex items-start gap-3 cursor-pointer hover:border-blue-400 hover:shadow-sm transition-all">
              {r.image_url ? (
                <a href={r.item_id ? `https://www.ebay.co.uk/itm/${r.item_id}` : '#'} target="_blank" rel="noopener noreferrer" className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.image_url} alt="" className="h-11 w-11 rounded-lg object-cover border border-slate-200" />
                </a>
              ) : (
                <div className="h-11 w-11 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0"><PackageOpen className="h-5 w-5 text-slate-300" /></div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {r.reason_type && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${reasonTone(r.reason_type)}`}>{nice(r.reason_type)}</span>}
                  <span className="text-sm text-slate-800 truncate">{r.item_title || `Item ${r.item_id ?? ''}`}</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {r.reason && <span>{nice(r.reason)} · </span>}
                  <span className="text-slate-600 font-medium">{nice(r.status || r.state)}</span>
                  {r.return_type && <span> · {nice(r.return_type)}</span>}
                </p>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                  {r.creation_date && <span>{new Date(r.creation_date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                  {r.buyer_login && <span>· {r.buyer_login}</span>}
                  {r.refund_amount != null && <span>· refund {r.currency === 'GBP' ? '£' : ''}{Number(r.refund_amount).toFixed(2)}</span>}
                  {r.order_id && <span>· #{r.order_id}</span>}
                  <a href={`https://www.ebay.co.uk/returns/rtn?returnId=${r.return_id}`} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-blue-600 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    case <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* eBay return case detail */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h3 className="font-bold text-slate-900 flex items-center gap-2"><FileText className="h-5 w-5 text-blue-600" /> Return case #{detail.return_id}</h3>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[70vh] space-y-4 text-sm">
              {detailLoading && <p className="text-xs text-slate-500 flex items-center gap-1"><RefreshCw className="h-3 w-3 animate-spin" /> Loading case details from eBay…</p>}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                  <p className="text-slate-500">eBay Order</p>
                  <p className="font-mono font-medium">{detail.order_id ?? '—'}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                  <p className="text-slate-500">Buyer</p>
                  <p className="font-medium">{detail.buyer_login ?? '—'}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                  <p className="text-slate-500">Reason</p>
                  <p className="font-medium">{nice(detail.reason)} {detail.reason_type && <span className={`ml-1 px-1.5 py-0.5 rounded border ${reasonTone(detail.reason_type)}`}>{nice(detail.reason_type)}</span>}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                  <p className="text-slate-500">Status</p>
                  <p className="font-medium">{nice(detail.status || detail.state)}</p>
                </div>
                {detail.refund_amount != null && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                    <p className="text-slate-500">Refund</p>
                    <p className="font-medium">{detail.currency === 'GBP' ? '£' : detail.currency || ''}{Number(detail.refund_amount).toFixed(2)}</p>
                  </div>
                )}
                {detail.creation_date && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                    <p className="text-slate-500">Created</p>
                    <p className="font-medium">{new Date(detail.creation_date).toLocaleString('en-GB')}</p>
                  </div>
                )}
              </div>
              {detail.raw && (
                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-1">Case details from eBay</p>
                  <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] text-slate-600 overflow-auto max-h-80">
                    {JSON.stringify(detail.raw, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
