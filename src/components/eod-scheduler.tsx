'use client';

import { useCallback } from 'react';
import { useOrderStore } from '@/lib/store';
import { useSettingBool, useSettingString, useSettingList } from '@/hooks/use-settings';
import {
  useEodScheduler,
  buildEodCsvText,
  downloadEodCsv,
  notifyEodTriggered,
} from '@/lib/use-eod-scheduler';

export function EodScheduler() {
  const eodEvents = useOrderStore((s) => s.eodEvents);
  const emailConfig = useOrderStore((s) => s.emailConfig);
  // Schedule + recipients are configurable (Settings → Reporting & Alerts).
  const eodEnabled = useSettingBool('eod.enabled');
  const eodSendAt = useSettingString('eod.sendAt');
  const eodRecipients = useSettingList('eod.recipients');

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

    // Send email to the configured recipients. Settings recipients take
    // precedence; fall back to the legacy single emailConfig recipient.
    const recipients = eodRecipients.length > 0
      ? eodRecipients
      : (emailConfig.enabled && emailConfig.recipientEmail ? [emailConfig.recipientEmail] : []);
    if (eodEnabled && recipients.length > 0) {
      for (const recipientEmail of recipients) {
      try {
        const res = await fetch('/api/send-eod', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            csvText,
            date: dateStr,
            recipientEmail,
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
          toast.success(`EOD report emailed to ${recipientEmail}`)
        );
      } catch (err) {
        import('sonner').then(({ toast }) =>
          toast.error(`EOD email failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
        );
      }
      }
    }
  }, [eodEvents, emailConfig, eodEnabled, eodRecipients]);

  useEodScheduler(handleEod, { enabled: eodEnabled, sendAt: eodSendAt });

  return null; // Invisible background component
}
