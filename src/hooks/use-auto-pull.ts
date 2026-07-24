'use client';

import { useEffect, useRef } from 'react';
import { useOrderStore } from '@/lib/store';
import { supabase, isSupabaseConfigured } from '@/lib/supabase-client';
import { Order, Batch } from '@/lib/types';
import { getOrderPlatform } from '@/lib/order-utils';
import { fetchPrinterConfig, printInvoicesFor } from '@/lib/print-agent';
import { autoBookLabels } from '@/lib/auto-book';
import { useSettingBool, useSettingNumber, useSettingList } from '@/hooks/use-settings';
import { toast } from 'sonner';

// Automatic order pulling. Every open client checks a shared timestamp and, if
// the interval has elapsed, pulls new orders from every connected marketplace
// and merges them in. The shared gate means only one client pulls per window
// (small races are harmless — addOrders + Supabase upserts are idempotent).

const CHECK_INTERVAL_MS = 5 * 60 * 1000;   // how often each client checks the gate
const LAST_RUN_KEY = 'auto_pull_last_run';

async function pullSource(source: string, windowDays: number, addOrders: (o: Order[], b: Batch) => void): Promise<Order[]> {
  try {
    const res = await fetch(`/api/${source}/orders?days=${windowDays}`);
    if (!res.ok) return [];
    const data = await res.json() as { orders?: Order[]; batch?: Batch };
    if (!data.orders?.length || !data.batch) return [];
    // Only commit genuinely-new orders so repeated pulls don't churn batches,
    // reassign batchIds, or reset the status of orders already being worked.
    const known = new Set(useOrderStore.getState().orders.map((o) => o.salesRecordNumber).filter(Boolean));
    const fresh = data.orders.filter((o) => o.salesRecordNumber && !known.has(o.salesRecordNumber));
    if (!fresh.length) return [];
    addOrders(fresh, { ...data.batch, orderCount: fresh.length });
    return fresh;
  } catch {
    return [];
  }
}

export function useAutoPull() {
  const addOrders = useOrderStore((s) => s.addOrders);
  const running = useRef(false);

  // All configurable from Settings → Workflow & Queue / Printing.
  const enabled = useSettingBool('autopull.enabled');
  const intervalMinutes = useSettingNumber('autopull.intervalMinutes');
  const windowDays = useSettingNumber('autopull.windowDays');
  const sources = useSettingList('autopull.sources');
  const autoInvoiceEnabled = useSettingBool('print.autoInvoiceOnPull');
  const invoiceMarketplaces = useSettingList('print.invoiceMarketplaces');

  useEffect(() => {
    if (!isSupabaseConfigured() || !enabled) return;
    let cancelled = false;
    const pullIntervalMs = Math.max(1, intervalMinutes) * 60 * 1000;

    async function maybePull() {
      if (running.current || cancelled) return;
      running.current = true;
      try {
        // Shared gate across every open client — only pull if the interval elapsed.
        const { data } = await supabase.from('app_settings').select('value').eq('key', LAST_RUN_KEY).single();
        const last = data?.value ? new Date(data.value as string).getTime() : 0;
        if (Date.now() - last < pullIntervalMs) return;
        // Claim the window before pulling so concurrent clients don't double-run.
        await supabase.from('app_settings').upsert({ key: LAST_RUN_KEY, value: new Date().toISOString(), updated_at: new Date().toISOString() });

        const fresh: Order[] = [];
        for (const src of sources) fresh.push(...await pullSource(src, windowDays, addOrders));
        if (fresh.length > 0 && !cancelled) {
          toast.success(`Auto-pulled ${fresh.length} new order${fresh.length !== 1 ? 's' : ''}`, { icon: '🔄' });
          // Book carrier labels straight away (book only — printed at packing).
          // Tracking is messaged to the buyer; eBay fulfilment happens on ship.
          try {
            const booked = await autoBookLabels(fresh);
            if (booked > 0) toast.success(`Auto-booked ${booked} label${booked !== 1 ? 's' : ''} — tracking sent to buyer${booked !== 1 ? 's' : ''}`, { icon: '🏷️' });
          } catch (e) {
            console.error('[auto-pull] label auto-booking failed', e);
          }
          // Auto-print invoices for the new orders (if a printer is configured).
          try {
            const cfg = await fetchPrinterConfig();
            // Invoicing is scoped per marketplace (Settings → Printing & Documents).
            const toInvoice = fresh.filter((o) => invoiceMarketplaces.includes(getOrderPlatform(o)));
            if (autoInvoiceEnabled && cfg.autoInvoice && toInvoice.length > 0) {
              const printed = await printInvoicesFor(toInvoice, cfg);
              if (printed) toast.success(`Printing ${toInvoice.length} invoice${toInvoice.length !== 1 ? 's' : ''}`, { icon: '🖨️' });
            }
          } catch (e) {
            console.error('[auto-pull] invoice print failed', e);
          }
        }
      } catch (e) {
        console.error('[auto-pull] failed', e);
      } finally {
        running.current = false;
      }
    }

    maybePull();                                    // check on mount — pulls if due
    const timer = setInterval(maybePull, CHECK_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [addOrders, enabled, intervalMinutes, windowDays, sources, autoInvoiceEnabled, invoiceMarketplaces]);
}
