'use client';

import { useMemo, useState, useEffect } from 'react';
import { useOrderStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { RefreshCw, Truck, PackageCheck, AlertTriangle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { runTrackingCheck } from '@/lib/tracking-client';

export function TrackingMonitor() {
  const orders = useOrderStore((s) => s.orders);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [results, setResults] = useState<{ orderId: string; trackingNumber: string; carrier: string; status: string; message?: string; error?: string }[]>([]);

  const packedOrders = useMemo(
    () => orders.filter((o) => o.status === 'packed' && o.trackingNumber && o.deliveryCarrier && !o.deletedAt),
    [orders]
  );
  const shippedOrders = useMemo(
    () => orders.filter((o) => o.status === 'shipped' && o.trackingNumber && o.deliveryCarrier && !o.deletedAt),
    [orders]
  );
  const trackableCount = packedOrders.length + shippedOrders.length;

  const deliveredOrders = useMemo(
    () => orders.filter((o) => o.status === 'delivered' && !o.deletedAt),
    [orders]
  );

  // Persist the last check on this device so the results survive a reload.
  const STORE_KEY = 'tracking-last-results';
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { const d = JSON.parse(raw); setResults(d.results || []); setLastChecked(d.lastChecked || null); }
    } catch { /* ignore */ }
  }, []);

  const checkAll = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const { moved, delivered, checked, results } = await runTrackingCheck();
      const when = new Date().toLocaleString('en-GB');
      setResults(results);
      setLastChecked(when);
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ results, lastChecked: when })); } catch { /* ignore */ }
      if (delivered > 0 || moved > 0) {
        toast.success(`${moved} moved to Shipped, ${delivered} delivered`);
      } else if (checked > 0) {
        toast.info(`Checked ${checked} parcel${checked === 1 ? '' : 's'} — no new movement`);
      } else {
        toast.info('No packed or shipped orders with tracking to check');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Tracking check failed');
    } finally {
      setChecking(false);
    }
  };

  // Auto-check every 4 hours while the page is open
  useEffect(() => {
    const interval = setInterval(() => {
      if (trackableCount > 0) checkAll();
    }, 4 * 60 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackableCount]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Tracking Monitor</h2>
          <p className="text-slate-500 text-sm mt-1">
            Checks DPD &amp; FedEx tracking: packed orders move to Shipped on the first courier scan, and shipped orders to Delivered on delivery.
          </p>
        </div>
        <Button onClick={checkAll} disabled={checking || trackableCount === 0}>
          <RefreshCw className={`h-4 w-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
          {checking ? 'Checking…' : `Check ${trackableCount} parcel${trackableCount === 1 ? '' : 's'}`}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Shipped</CardTitle>
            <Truck className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{shippedOrders.length}</div>
            <p className="text-xs text-slate-500 mt-1">Awaiting delivery</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Delivered</CardTitle>
            <PackageCheck className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{deliveredOrders.length}</div>
            <p className="text-xs text-slate-500 mt-1">Confirmed delivered</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Last Checked</CardTitle>
            <CheckCircle className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium text-slate-700">{lastChecked || 'Not yet'}</div>
            <p className="text-xs text-slate-500 mt-1">Auto-check every 4 hours</p>
          </CardContent>
        </Card>
      </div>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Last Check Results
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs">Order</TableHead>
                    <TableHead className="text-xs">Carrier</TableHead>
                    <TableHead className="text-xs">Tracking #</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.orderId}>
                      <TableCell className="text-xs font-mono">{orders.find((o) => o.id === r.orderId)?.salesRecordNumber || r.orderId}</TableCell>
                      <TableCell className="text-xs">{r.carrier}</TableCell>
                      <TableCell className="text-xs font-mono">{r.trackingNumber}</TableCell>
                      <TableCell className="text-xs">
                        <Badge
                          variant="outline"
                          className={
                            r.status === 'delivered'
                              ? 'bg-green-100 text-green-800 border-green-300'
                              : r.status === 'error'
                              ? 'bg-red-100 text-red-800 border-red-300'
                              : 'bg-blue-100 text-blue-800 border-blue-300'
                          }
                        >
                          {r.status === 'in_transit' ? 'In transit' : r.status === 'delivered' ? 'Delivered' : r.status === 'shipped' ? 'Shipped' : 'Error'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {r.status === 'error' ? (
                          <span className="flex items-center gap-1 text-red-600">
                            <AlertTriangle className="h-3 w-3" />
                            {r.message || r.error || 'Error'}
                          </span>
                        ) : (
                          r.message || '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {shippedOrders.length === 0 && deliveredOrders.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-500">
            No shipped orders to track. Book labels and mark orders as shipped to begin tracking.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
