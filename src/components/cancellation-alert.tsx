'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, X, RefreshCw } from 'lucide-react';
import { useOrderStore } from '@/lib/store';
import { useSettingNumber, useSettingBool } from '@/hooks/use-settings';

interface CancellationItem {
  orderId: string;
  buyerUsername?: string;
  itemTitle?: string;
  cancelReason?: string;
  createdAt?: string;
}


export function CancellationAlert() {
  // Poll cadence + whether the full-screen alert shows (Settings → Reporting & Alerts).
  const pollMs = useSettingNumber('alerts.cancellationPollMinutes') * 60 * 1000;
  const fullScreenAlert = useSettingBool('alerts.cancellationFullScreen');

  const orders = useOrderStore((s) => s.orders);
  const softCancelOrder = useOrderStore((s) => s.softCancelOrder);

  const [cancellations, setCancellations] = useState<CancellationItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const fetchCancellations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ebay/cancellations');
      if (!res.ok) return;
      const data = await res.json() as { cancellations?: CancellationItem[] };
      if (data.cancellations?.length) {
        setCancellations(data.cancellations);

        // Auto-soft-cancel matched orders + raise them to Comms as priority.
        for (const c of data.cancellations) {
          const order = orders.find(
            (o) => o.orderNumber === c.orderId || o.salesRecordNumber === c.orderId
          );
          if (order && order.status !== 'cancelled' && order.status !== 'shipped') {
            softCancelOrder(order.id, c.cancelReason ? `Buyer cancellation request: ${c.cancelReason}` : 'Buyer requested cancellation on eBay');
          }
        }
      } else {
        setCancellations([]);
      }
    } catch {
      // silently ignore — non-critical
    } finally {
      setLoading(false);
    }
  }, [orders, softCancelOrder]);

  useEffect(() => {
    fetchCancellations();
    const timer = setInterval(fetchCancellations, pollMs);
    return () => clearInterval(timer);
  }, [pollMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = cancellations.filter((c) => !dismissed.has(c.orderId));

  if (!fullScreenAlert || !visible.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full">
      {visible.map((c) => (
        <div
          key={c.orderId}
          className="flex items-start gap-3 bg-red-600 text-white rounded-xl shadow-lg px-4 py-3"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Cancellation Request</p>
            <p className="text-xs text-red-100 mt-0.5 font-mono">eBay order #{c.orderId}</p>
            {c.buyerUsername && (
              <p className="text-xs text-red-100">Buyer: {c.buyerUsername}</p>
            )}
            {c.itemTitle && (
              <p className="text-xs text-red-100 truncate">{c.itemTitle}</p>
            )}
            {c.cancelReason && (
              <p className="text-xs text-red-200 mt-0.5 italic">Reason: {c.cancelReason}</p>
            )}
          </div>
          <button
            onClick={() => setDismissed((prev) => new Set([...prev, c.orderId]))}
            className="shrink-0 hover:opacity-75 mt-0.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex justify-end">
        <button
          onClick={fetchCancellations}
          disabled={loading}
          className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
    </div>
  );
}
