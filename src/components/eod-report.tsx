'use client';

import { useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { ORDER_STATUS_CONFIG, OrderStatus } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FileText, Truck, Package, TrendingUp, Trash2, Download, Mail, Clock, Send, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { buildEodCsvText, downloadEodCsv } from '@/lib/use-eod-scheduler';

export function EodReport() {
  const orders = useOrderStore((s) => s.orders);
  const eodEvents = useOrderStore((s) => s.eodEvents);
  const clearEodEvents = useOrderStore((s) => s.clearEodEvents);
  const emailConfig = useOrderStore((s) => s.emailConfig);
  const setEmailConfig = useOrderStore((s) => s.setEmailConfig);
  const [showEmailSettings, setShowEmailSettings] = useState(false);
  const [testSending, setTestSending] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);

  // Next 8pm GMT
  const nextTrigger = useMemo(() => {
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0, 0, 0));
    if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
    return target;
  }, []);

  const todayEvents = useMemo(
    () => eodEvents.filter((e) => e.changedAt.slice(0, 10) === todayStr),
    [eodEvents, todayStr]
  );

  const byDate = useMemo(() => {
    const map: Record<string, typeof eodEvents> = {};
    for (const e of eodEvents) {
      const d = e.changedAt.slice(0, 10);
      if (!map[d]) map[d] = [];
      map[d].push(e);
    }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [eodEvents]);

  const todayRevenue = useMemo(() => {
    const shippedTodayIds = new Set(
      todayEvents.filter((e) => e.toStatus === 'shipped').map((e) => e.orderId)
    );
    return orders
      .filter((o) => shippedTodayIds.has(o.id))
      .reduce((sum, o) => sum + o.soldFor, 0);
  }, [todayEvents, orders]);

  const todayShipped = todayEvents.filter((e) => e.toStatus === 'shipped').length;
  const todayPacked = todayEvents.filter((e) => e.toStatus === 'packed').length;

  const handleExportDay = (date: string, events: typeof eodEvents) => {
    const csvText = buildEodCsvText(date, events);
    downloadEodCsv(date, csvText);
    toast.success(`EOD report for ${date} downloaded`);
  };

  const handleTestTrigger = async () => {
    if (todayEvents.length === 0) { toast.error('No events today to report'); return; }
    const csvText = buildEodCsvText(todayStr, todayEvents);
    downloadEodCsv(todayStr, csvText);
    toast.success('EOD report downloaded (manual trigger)');

    if (emailConfig.enabled && emailConfig.recipientEmail) {
      setTestSending(true);
      try {
        const res = await fetch('/api/send-eod', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            csvText, date: todayStr,
            recipientEmail: emailConfig.recipientEmail,
            smtpHost: emailConfig.smtpHost, smtpPort: emailConfig.smtpPort,
            smtpUser: emailConfig.smtpUser, smtpPass: emailConfig.smtpPass,
            fromAddress: emailConfig.fromAddress,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast.success(`Email sent to ${emailConfig.recipientEmail}`);
      } catch (err) {
        toast.error(`Email failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setTestSending(false);
      }
    }
  };

  const handleClear = () => {
    clearEodEvents();
    toast.success('EOD event log cleared');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">End of Day Report</h2>
          <p className="text-slate-500 text-sm mt-1">
            Daily activity summary — {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 rounded px-2 py-1">
            <Clock className="h-3 w-3" />
            Auto-runs {nextTrigger.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} GMT
            {nextTrigger.toDateString() !== new Date().toDateString() ? ' tomorrow' : ' today'}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestTrigger}
            disabled={todayEvents.length === 0 || testSending}
          >
            <Send className="h-3 w-3 mr-1" />
            {testSending ? 'Sending...' : 'Run Now'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExportDay(todayStr, todayEvents)}
            disabled={todayEvents.length === 0}
          >
            <Download className="h-3 w-3 mr-1" />
            Export Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowEmailSettings((v) => !v)}
            className={emailConfig.enabled ? 'border-green-400 text-green-700' : ''}
          >
            <Mail className="h-3 w-3 mr-1" />
            {emailConfig.enabled ? 'Email On' : 'Setup Email'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={eodEvents.length === 0}
            className="text-red-600 border-red-200 hover:bg-red-50"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear Log
          </Button>
        </div>
      </div>

      {/* Email settings panel */}
      {showEmailSettings && (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Email Notification Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-500">
              EOD reports will be emailed automatically at 8pm GMT when enabled.
              Requires SMTP configuration — install <code className="bg-slate-100 px-1 rounded">nodemailer</code> and
              fill in the credentials below, then uncomment the sending code in{' '}
              <code className="bg-slate-100 px-1 rounded">/api/send-eod/route.ts</code>.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm col-span-full">
                <input
                  type="checkbox"
                  checked={emailConfig.enabled}
                  onChange={(e) => setEmailConfig({ enabled: e.target.checked })}
                  className="rounded"
                />
                Enable email notifications
              </label>
              <label className="flex items-center gap-2 text-sm col-span-full">
                <input
                  type="checkbox"
                  checked={emailConfig.autoSendAt8pm}
                  onChange={(e) => setEmailConfig({ autoSendAt8pm: e.target.checked })}
                  className="rounded"
                />
                Auto-send at 8pm GMT
              </label>
              {[
                { label: 'Recipient Email', field: 'recipientEmail' as const, type: 'email', placeholder: 'manager@company.com' },
                { label: 'From Address',    field: 'fromAddress'    as const, type: 'email', placeholder: 'orders@company.com' },
                { label: 'SMTP Host',       field: 'smtpHost'       as const, type: 'text',  placeholder: 'smtp.gmail.com' },
                { label: 'SMTP User',       field: 'smtpUser'       as const, type: 'text',  placeholder: 'user@gmail.com' },
                { label: 'SMTP Password',   field: 'smtpPass'       as const, type: 'password', placeholder: '••••••••' },
                { label: 'SMTP Port',       field: 'smtpPort'       as const, type: 'number', placeholder: '587' },
              ].map(({ label, field, type, placeholder }) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                  <input
                    type={type}
                    value={emailConfig[field]}
                    placeholder={placeholder}
                    onChange={(e) => setEmailConfig({ [field]: type === 'number' ? Number(e.target.value) : e.target.value })}
                    className="w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => { setShowEmailSettings(false); toast.success('Email settings saved'); }}>
                Save Settings
              </Button>
              <Button size="sm" variant="outline" onClick={handleTestTrigger} disabled={testSending || todayEvents.length === 0}>
                <Send className="h-3 w-3 mr-1" />
                {testSending ? 'Sending...' : 'Test Send Now'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Today's summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Shipped Today</CardTitle>
            <Truck className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-600">{todayShipped}</div>
            <p className="text-xs text-slate-500 mt-1">Orders dispatched</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Packed Today</CardTitle>
            <Package className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{todayPacked}</div>
            <p className="text-xs text-slate-500 mt-1">Ready for dispatch</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Revenue Shipped</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">
              £{todayRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-slate-500 mt-1">Value dispatched today</p>
          </CardContent>
        </Card>
      </div>

      {/* Today's event log */}
      <Card>
        <CardHeader className="flex items-center justify-between flex-row">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Today&apos;s Activity ({todayEvents.length} events)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {todayEvents.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <FileText className="h-10 w-10 mx-auto mb-2 text-slate-200" />
              <p>No activity recorded today yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Time</TableHead>
                  <TableHead className="text-xs">Order #</TableHead>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs">From</TableHead>
                  <TableHead className="text-xs">To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...todayEvents].reverse().map((event, i) => (
                  <TableRow key={`${event.orderId}-${i}`}>
                    <TableCell className="text-xs text-slate-500 font-mono">
                      {new Date(event.changedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{event.salesRecordNumber}</TableCell>
                    <TableCell className="text-xs max-w-[250px] truncate">{event.itemTitle}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs ${ORDER_STATUS_CONFIG[event.fromStatus as OrderStatus]?.color || ''}`}
                      >
                        {ORDER_STATUS_CONFIG[event.fromStatus as OrderStatus]?.label || event.fromStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs ${ORDER_STATUS_CONFIG[event.toStatus as OrderStatus]?.color || ''}`}
                      >
                        {ORDER_STATUS_CONFIG[event.toStatus as OrderStatus]?.label || event.toStatus}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Historical reports */}
      {byDate.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Previous Days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {byDate
                .filter(([date]) => date !== todayStr)
                .map(([date, events]) => (
                  <div
                    key={date}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(date).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {events.filter((e) => e.toStatus === 'shipped').length} shipped &bull;{' '}
                        {events.filter((e) => e.toStatus === 'packed').length} packed &bull;{' '}
                        {events.length} total events
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExportDay(date, events)}
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Export
                    </Button>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
