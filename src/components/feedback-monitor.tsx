'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, X, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface Negative {
  feedback_id: string;
  comment_text: string | null;
  listing_title: string | null;
  buyer_masked: string | null;
  ticket_id: string | null;
}

const POLL_MS = 5 * 60 * 1000; // check every 5 minutes while the app is open

export function FeedbackMonitor() {
  const router = useRouter();
  const [negatives, setNegatives] = useState<Negative[]>([]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/ebay/feedback/sync');
      if (r.ok) { const d = await r.json() as { negatives?: Negative[] }; setNegatives(d.negatives ?? []); }
    } catch { /* non-critical */ }
  }, []);

  const sync = useCallback(async () => {
    try {
      const r = await fetch('/api/ebay/feedback/sync', { method: 'POST' });
      if (r.ok) {
        const d = await r.json() as { newNegatives?: number };
        if ((d.newNegatives ?? 0) > 0) {
          toast.error(`${d.newNegatives} new negative feedback received`, { duration: 12000 });
        }
      }
      await refresh();
    } catch { /* non-critical */ }
  }, [refresh]);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    sync();
    const t = setInterval(sync, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function acknowledge(id: string) {
    setNegatives((prev) => prev.filter((n) => n.feedback_id !== id));
    try {
      await fetch('/api/ebay/feedback/sync', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedbackIds: [id] }) });
    } catch { /* ignore */ }
  }

  if (!negatives.length) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm w-full">
      {negatives.map((n) => (
        <div key={n.feedback_id} className="flex items-start gap-3 bg-red-600 text-white rounded-xl shadow-lg px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Negative feedback received</p>
            {n.listing_title && <p className="text-xs text-red-100 truncate mt-0.5">{n.listing_title}</p>}
            {n.comment_text && <p className="text-xs text-red-100 mt-0.5 italic">“{n.comment_text}”</p>}
            <button onClick={() => router.push('/notes')} className="text-xs underline mt-1.5 flex items-center gap-1 hover:text-white">
              Open ticket <ExternalLink className="h-3 w-3" />
            </button>
          </div>
          <button onClick={() => acknowledge(n.feedback_id)} title="Dismiss" className="shrink-0 hover:opacity-75 mt-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
