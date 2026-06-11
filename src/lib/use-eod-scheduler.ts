'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/** Returns ms until the next 20:00 GMT (8pm) */
function msUntil8pmGMT(): number {
  const now = new Date();
  // Build today's 20:00 UTC
  const target = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    20, 0, 0, 0,
  ));
  // If we've already passed 20:00 today, schedule for tomorrow
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

type EodTriggerFn = () => void;

/**
 * Schedules the EOD trigger at 20:00 GMT every day.
 * Pass a stable callback that runs the EOD export / email send.
 */
export function useEodScheduler(onTrigger: EodTriggerFn) {
  const callbackRef = useRef(onTrigger);
  callbackRef.current = onTrigger;

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    function schedule() {
      const ms = msUntil8pmGMT();
      const fireAt = new Date(Date.now() + ms);
      console.info(`[EOD Scheduler] Next trigger at ${fireAt.toUTCString()}`);

      timeoutId = setTimeout(() => {
        callbackRef.current();
        // Reschedule for the next day
        schedule();
      }, ms);
    }

    schedule();

    return () => clearTimeout(timeoutId);
  }, []);
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
