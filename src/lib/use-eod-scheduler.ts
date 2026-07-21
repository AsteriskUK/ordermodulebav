'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/** Returns ms until the next occurrence of hh:mm GMT. */
function msUntilGMT(hh: number, mm: number): number {
  const now = new Date();
  const target = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hh, mm, 0, 0,
  ));
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

type EodTriggerFn = () => void;

/**
 * Schedules the EOD trigger daily at the configured time (Settings → Reporting).
 * Pass a stable callback and the schedule options; re-schedules if they change.
 */
export function useEodScheduler(onTrigger: EodTriggerFn, opts: { enabled: boolean; sendAt: string }) {
  const callbackRef = useRef(onTrigger);
  callbackRef.current = onTrigger;
  const { enabled, sendAt } = opts;

  useEffect(() => {
    if (!enabled) return;
    const [hhRaw, mmRaw] = (sendAt || '20:00').split(':');
    const hh = Math.min(23, Math.max(0, parseInt(hhRaw, 10) || 20));
    const mm = Math.min(59, Math.max(0, parseInt(mmRaw, 10) || 0));
    let timeoutId: ReturnType<typeof setTimeout>;

    function schedule() {
      const ms = msUntilGMT(hh, mm);
      const fireAt = new Date(Date.now() + ms);
      console.info(`[EOD Scheduler] Next trigger at ${fireAt.toUTCString()}`);

      timeoutId = setTimeout(() => {
        callbackRef.current();
        schedule();
      }, ms);
    }

    schedule();

    return () => clearTimeout(timeoutId);
  }, [enabled, sendAt]);
}

/** Build CSV text from eod events */
export function buildEodCsvText(
  date: string,
  events: Array<{
    salesRecordNumber: string;
    itemTitle: string;
    fromStatus: string;
    toStatus: string;
    changedAt: string;
    userName?: string;
    department?: string;
  }>
): string {
  const lines = [
    `End of Day Report — ${date}`,
    `Generated: ${new Date().toLocaleString('en-GB')}`,
    '',
    `Shipped: ${events.filter((e) => e.toStatus === 'shipped').length}`,
    `Packed: ${events.filter((e) => e.toStatus === 'packed').length}`,
    `Total events: ${events.length}`,
    '',
    'Order #,Item,From,To,Time,User,Department',
    ...events.map(
      (e) =>
        `${e.salesRecordNumber},"${e.itemTitle}",${e.fromStatus},${e.toStatus},` +
        `${new Date(e.changedAt).toLocaleTimeString('en-GB')},${e.userName ?? ''},${e.department ?? ''}`
    ),
  ];
  return lines.join('\n');
}

export function downloadEodCsv(date: string, csvText: string) {
  const blob = new Blob([csvText], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `eod_report_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function notifyEodTriggered(date: string) {
  toast.success(`EOD report for ${date} auto-generated at 8pm GMT`, {
    duration: 10000,
    description: 'Check your EOD Report page or downloads folder.',
  });
}
