'use client';

import { useCallback } from 'react';
import { useOrderStore } from '@/lib/store';
import {
  useEodScheduler,
  buildEodCsvText,
  downloadEodCsv,
  notifyEodTriggered,
} from '@/lib/use-eod-scheduler';

export function EodScheduler() {
  const eodEvents = useOrderStore((s) => s.eodEvents);
  const emailConfig = useOrderStore((s) => s.emailConfig);

  const handleEod = useCallback(async () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const todayEvents = eodEvents.filter((e) => e.changedAt.slice(0, 10) === dateStr);

    if (todayEvents.length === 0) {
      return; // Nothing to report
    }

    const csvText = buildEodCsvText(dateStr, todayEvents);

    // Always auto-download
    downloadEodCsv(dateStr, csvText);
    notifyEodTriggered(dateStr);

    // Send email if configured
    if (emailConfig.enabled && emailConfig.recipientEmail && emailConfig.autoSendAt8pm) {
      try {
        const res = await fetch('/api/send-eod', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            csvText,
            date: dateStr,
            recipientEmail: emailConfig.recipientEmail,
            smtpHost:    emailConfig.smtpHost,
            smtpPort:    emailConfig.smtpPort,
            smtpUser:    emailConfig.smtpUser,
            smtpPass:    emailConfig.smtpPass,
            fromAddress: emailConfig.fromAddress,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        import('sonner').then(({ toast }) =>
          toast.success(`EOD report emailed to ${emailConfig.recipientEmail}`)
        );
      } catch (err) {
        import('sonner').then(({ toast }) =>
          toast.error(`EOD email failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
        );
      }
    }
  }, [eodEvents, emailConfig]);

  useEodScheduler(handleEod);

  return null; // Invisible background component
}
