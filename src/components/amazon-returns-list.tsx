'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, PackageOpen } from 'lucide-react';
import { toast } from 'sonner';

interface AmazonReturnRow {
  id: string;
  order_number: string | null;
  sales_record_number: string | null;
  item_title: string | null;
  reason: string | null;
  status: string | null;
  returned_at: string | null;
  buyer_username: string | null;
  metadata?: { amazon_rma_id?: string; asin?: string; sku?: string } | null;
}

export function AmazonReturnsList() {
  const [returns, setReturns] = useState<AmazonReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/amazon/returns');
      if (res.ok) setReturns((await res.json()).returns ?? []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/amazon/returns', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.pending) {
        // Report generation is async — Amazon rate-limits the request, so we poll
        // on the next click rather than blocking here.
        toast.info(data.message || 'Amazon returns report generating — sync again shortly.');
      } else if (res.ok) {
        toast.success(`Synced ${data.synced ?? 0} Amazon returns — ${data.created ?? 0} new`);
        await load();
      } else if (res.status === 401) {
        toast.error('Amazon not configured');
      } else {
        toast.error(`Amazon returns sync failed: ${data.message || data.error || 'error'}`);
      }
    } catch { toast.error('Amazon returns sync failed'); } finally { setSyncing(false); }
  }, [load]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <PackageOpen className="h-4 w-4 text-orange-500" /> Amazon Returns
          <span className="text-xs font-normal text-slate-400">{returns.length}</span>
        </h3>
        <Button size="sm" variant="outline" onClick={sync} disabled={syncing} className="h-7 text-xs gap-1">
          <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Syncing…' : 'Sync'}
        </Button>
      </div>
      {loading ? (
        <p className="text-xs text-slate-400 px-4 py-6 text-center">Loading…</p>
      ) : returns.length === 0 ? (
        <p className="text-xs text-slate-400 px-4 py-6 text-center">
          No Amazon returns yet. Click Sync to pull them from Amazon (the report may take a moment to generate).
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {returns.map((r) => (
            <div key={r.id} className="px-4 py-2.5 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-700 truncate">{r.item_title || '—'}</p>
                <p className="text-[11px] text-slate-400">
                  <span className="font-mono">{r.order_number}</span>
                  {r.metadata?.sku ? ` · ${r.metadata.sku}` : ''}
                  {r.buyer_username ? ` · ${r.buyer_username}` : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border bg-orange-50 text-orange-700 border-orange-200">
                  {r.reason || 'Return'}
                </span>
                {r.returned_at && (
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {new Date(r.returned_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
