'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ThumbsDown, ThumbsUp, Minus, RefreshCw, ExternalLink, Check, MessageSquareWarning } from 'lucide-react';

interface FeedbackRow {
  feedback_id: string;
  comment_type: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | null;
  comment_text: string | null;
  listing_id: string | null;
  listing_title: string | null;
  price: number | null;
  currency: string | null;
  buyer_masked: string | null;
  entered_period: string | null;
  automated: boolean | null;
  ticket_id: string | null;
  acknowledged: boolean | null;
  first_seen_at: string;
}

type Filter = 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE' | 'ALL';

const TYPE_META = {
  NEGATIVE: { label: 'Negative', icon: ThumbsDown, color: 'bg-red-100 text-red-700 border-red-300', dot: 'text-red-500' },
  NEUTRAL:  { label: 'Neutral',  icon: Minus,      color: 'bg-amber-100 text-amber-700 border-amber-300', dot: 'text-amber-500' },
  POSITIVE: { label: 'Positive', icon: ThumbsUp,   color: 'bg-green-100 text-green-700 border-green-300', dot: 'text-green-500' },
} as const;

export function FeedbackList() {
  const [filter, setFilter] = useState<Filter>('NEGATIVE');
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [counts, setCounts] = useState<{ NEGATIVE: number; NEUTRAL: number; POSITIVE: number }>({ NEGATIVE: 0, NEUTRAL: 0, POSITIVE: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase.from('ebay_feedback').select('*').order('first_seen_at', { ascending: false }).limit(200);
      if (filter !== 'ALL') q = q.eq('comment_type', filter);
      const { data } = await q;
      setRows((data ?? []) as FeedbackRow[]);

      // Counts per type
      const types: (keyof typeof counts)[] = ['NEGATIVE', 'NEUTRAL', 'POSITIVE'];
      const results = await Promise.all(types.map((t) =>
        supabase.from('ebay_feedback').select('feedback_id', { count: 'exact', head: true }).eq('comment_type', t)
      ));
      setCounts({ NEGATIVE: results[0].count ?? 0, NEUTRAL: results[1].count ?? 0, POSITIVE: results[2].count ?? 0 });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch('/api/ebay/feedback/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.message || 'Sync failed'); return; }
      if (data.newNegatives > 0) toast.error(`${data.newNegatives} new negative feedback`);
      else toast.success('Feedback up to date');
      await load();
    } catch {
      toast.error('Failed to sync feedback');
    } finally {
      setSyncing(false);
    }
  }

  async function acknowledge(id: string) {
    setRows((prev) => prev.map((r) => r.feedback_id === id ? { ...r, acknowledged: true } : r));
    await fetch('/api/ebay/feedback/sync', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedbackIds: [id] }) });
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'NEGATIVE', label: `Negative${counts.NEGATIVE ? ` (${counts.NEGATIVE})` : ''}` },
    { key: 'NEUTRAL', label: `Neutral${counts.NEUTRAL ? ` (${counts.NEUTRAL})` : ''}` },
    { key: 'POSITIVE', label: `Positive${counts.POSITIVE ? ` (${counts.POSITIVE})` : ''}` },
    { key: 'ALL', label: 'All' },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <MessageSquareWarning className="h-6 w-6 text-red-500" /> Feedback
          </h2>
          <p className="text-slate-500 text-sm mt-1">Feedback received on your eBay account. New negatives auto-raise an urgent ticket.</p>
        </div>
        <Button onClick={syncNow} disabled={syncing} variant="outline">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Checking…' : 'Check now'}
        </Button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${filter === f.key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400"><RefreshCw className="h-6 w-6 mx-auto animate-spin mb-2" /><p className="text-sm">Loading…</p></div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <ThumbsUp className="h-12 w-12 mx-auto mb-3 text-slate-200" />
          <p className="font-medium">No {filter !== 'ALL' ? filter.toLowerCase() : ''} feedback</p>
          <p className="text-sm mt-1">Click &quot;Check now&quot; to pull the latest from eBay.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const meta = TYPE_META[r.comment_type ?? 'NEUTRAL'] ?? TYPE_META.NEUTRAL;
            const Icon = meta.icon;
            return (
              <div key={r.feedback_id} className={`border rounded-xl bg-white px-4 py-3 ${r.comment_type === 'NEGATIVE' && !r.acknowledged ? 'border-red-300 bg-red-50/40' : 'border-slate-200'}`}>
                <div className="flex items-start gap-3">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${meta.color}`}>{meta.label}</span>
                      {r.listing_title && <span className="text-sm text-slate-700 truncate">{r.listing_title}</span>}
                    </div>
                    {r.comment_text && <p className="text-sm text-slate-800 mt-1 italic">“{r.comment_text}”</p>}
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                      {r.buyer_masked && <span>Buyer {r.buyer_masked}</span>}
                      {r.entered_period && <span>· within {r.entered_period.toLowerCase()}</span>}
                      {r.price != null && <span>· {r.currency === 'GBP' ? '£' : ''}{Number(r.price).toFixed(2)}</span>}
                      {r.automated && <span>· auto</span>}
                      {r.listing_id && (
                        <a href={`https://www.ebay.co.uk/itm/${r.listing_id}`} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-blue-600 flex items-center gap-0.5">
                          listing <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </p>
                  </div>
                  {r.comment_type === 'NEGATIVE' && !r.acknowledged && (
                    <button onClick={() => acknowledge(r.feedback_id)} title="Acknowledge" className="shrink-0 text-slate-400 hover:text-green-600 flex items-center gap-1 text-xs">
                      <Check className="h-4 w-4" /> <span className="hidden sm:inline">Acknowledge</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
