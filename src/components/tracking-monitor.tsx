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

export function TrackingMonitor() {
  const orders = useOrderStore((s) => s.orders);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [results, setResults] = useState<{ orderId: string; trackingNumber: string; carrier: string; status: string; message?: string; error?: string }[]>([]);

  const shippedOrders = useMemo(
    () => orders.filter((o) => o.status === 'shipped' && o.trackingNumber && o.deliveryCarrier && !o.deletedAt),
    [orders]
  );

  const deliveredOrders = useMemo(
    () => orders.filter((o) => o.status === 'delivered' && !o.deletedAt),
    [orders]
  );

  const checkAll = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const res = await fetch('/api/tracking/check-all');
      const data = await res.json();
      if (data.success) {
        setResults(data.results || []);
        setLastChecked(new Date().toLocaleString('en-GB'));
        const delivered = (data.results || []).filter((r: { status: string }) => r.status === 'delivered').length;
        if (delivered > 0) {
          toast.success(`${delivered} order${delivered === 1 ? '' : 's'} marked as delivered`);
        } else {
          toast.info('No new deliveries detected');
        }
      } else {
        toast.error(data.message || 'Tracking check failed');
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
      if (shippedOrders.length > 0) checkAll();
    }, 4 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [shippedOrders.length]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Tracking Monitor</h2>
          <p className="text-slate-500 text-sm mt-1">
            Automatically checks DPD and FedEx tracking for shipped orders and marks them as delivered.
          </p>
        </div>
        <Button onClick={checkAll} disabled={checking || shippedOrders.length === 0}>
          <RefreshCw className={`h-4 w-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
          {checking ? 'Checking...' : `Check ${shippedOrders.length} Shipped`}
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
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {r.error ? (
                          <span className="flex items-center gap-1 text-red-600">
                            <AlertTriangle className="h-3 w-3" />
                            {r.error}
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
