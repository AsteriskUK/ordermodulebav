'use client';

import { useMemo } from 'react';
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
import { FileText, Truck, Package, TrendingUp, Trash2, Download } from 'lucide-react';
import { toast } from 'sonner';

export function EodReport() {
  const orders = useOrderStore((s) => s.orders);
  const eodEvents = useOrderStore((s) => s.eodEvents);
  const clearEodEvents = useOrderStore((s) => s.clearEodEvents);

  const todayStr = new Date().toISOString().slice(0, 10);

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
    const lines = [
      `End of Day Report — ${date}`,
      `Generated: ${new Date().toLocaleString('en-GB')}`,
      '',
      `Shipped: ${events.filter((e) => e.toStatus === 'shipped').length}`,
      `Packed: ${events.filter((e) => e.toStatus === 'packed').length}`,
      `Total events: ${events.length}`,
      '',
      'Order #,Item,From,To,Time',
      ...events.map(
        (e) =>
          `${e.salesRecordNumber},"${e.itemTitle}",${e.fromStatus},${e.toStatus},${new Date(e.changedAt).toLocaleTimeString('en-GB')}`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eod_report_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`EOD report for ${date} downloaded`);
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
        <div className="flex gap-2">
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
            onClick={handleClear}
            disabled={eodEvents.length === 0}
            className="text-red-600 border-red-200 hover:bg-red-50"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear Log
          </Button>
        </div>
      </div>

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
