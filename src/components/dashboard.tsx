'use client';

import { useRouter } from 'next/navigation';
import { useOrderStore } from '@/lib/store';
import { ORDER_STATUS_CONFIG, OrderStatus } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Package,
  Clock,
  Truck,
  CheckCircle,
  AlertTriangle,
  XCircle,
  RotateCcw,
  Wrench,
  ClipboardCheck,
  BoxSelect,
  PauseCircle,
  PackageOpen,
  Archive,
  Store,
} from 'lucide-react';

const statusIcons: Record<OrderStatus, React.ElementType> = {
  pending: Clock,
  assembling: Wrench,
  checking: ClipboardCheck,
  packing: BoxSelect,
  packed: Package,
  shipped: Truck,
  delivered: CheckCircle,
  held: PauseCircle,
  'no-stock': AlertTriangle,
  cancelled: XCircle,
  refunded: RotateCcw,
  returned: PackageOpen,
  archived: Archive,
};

export function Dashboard() {
  const router = useRouter();
  const orders = useOrderStore((s) => s.orders);
  const batches = useOrderStore((s) => s.batches);
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const currentUser = users.find((u) => u.id === currentUserId);
  const isCommsOnly = currentUser?.role === 'comms' || currentUser?.roles?.includes('comms') || currentUser?.department === 'comms' || currentUser?.departments?.includes('comms');

  const statusCounts = orders.reduce(
    (acc, order) => { acc[order.status] = (acc[order.status] || 0) + 1; return acc; },
    {} as Record<string, number>
  );

  const SOURCE_CONFIG: Record<string, { label: string; color: string; bg: string; bar: string }> = {
    ebay:        { label: 'eBay',        color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200',  bar: 'bg-yellow-400' },
    backmarket:  { label: 'Back Market', color: 'text-green-700',  bg: 'bg-green-50 border-green-200',   bar: 'bg-green-500'  },
    amazon:      { label: 'Amazon',      color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', bar: 'bg-orange-400' },
    temu:        { label: 'Temu',        color: 'text-rose-700',   bg: 'bg-rose-50 border-rose-200',     bar: 'bg-rose-400'   },
    onbuy:       { label: 'OnBuy',       color: 'text-cyan-700',   bg: 'bg-cyan-50 border-cyan-200',     bar: 'bg-cyan-400'   },
    manual:      { label: 'Manual',      color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200',     bar: 'bg-blue-400'   },
  };

  const sourceStats = batches.reduce((acc, batch) => {
    const src = batch.source ?? 'manual';
    if (!acc[src]) acc[src] = { orders: 0, revenue: 0, pending: 0, shipped: 0 };
    const batchOrders = orders.filter((o) => o.batchId === batch.id);
    acc[src].orders  += batchOrders.length;
    acc[src].revenue += batchOrders.reduce((s, o) => s + o.soldFor, 0);
    acc[src].pending += batchOrders.filter((o) => o.status === 'pending').length;
    acc[src].shipped += batchOrders.filter((o) => o.status === 'shipped').length;
    return acc;
  }, {} as Record<string, { orders: number; revenue: number; pending: number; shipped: number }>);

  const _total = orders.length || 1;
  const sourceEntries = Object.entries(sourceStats)
    .sort((a, b) => b[1].orders - a[1].orders)
    .map(([src, stats]) => ({
      src, stats,
      pct: Math.floor((stats.orders / _total) * 100),
      rem: ((stats.orders / _total) * 100) % 1,
    }));
  const _remainder = 100 - sourceEntries.reduce((s, e) => s + e.pct, 0);
  sourceEntries.slice().sort((a, b) => b.rem - a.rem).forEach((e, i) => { if (i < _remainder) e.pct += 1; });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          {isCommsOnly ? 'Comms Dashboard' : 'Dashboard'}
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          {isCommsOnly ? 'Buyer messages and tickets' : 'Overview of your warehouse pipeline'}
        </p>
      </div>

      {/* Order Sources — single compact row */}
      {!isCommsOnly && sourceEntries.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex divide-x divide-slate-100 overflow-x-auto">
              {sourceEntries.map(({ src, stats, pct }) => {
                const cfg = SOURCE_CONFIG[src] ?? { label: src, color: 'text-slate-700', bg: 'bg-slate-50', bar: 'bg-slate-400' };
                return (
                  <button
                    key={src}
                    onClick={() => router.push(`/orders?source=${src}`)}
                    className="flex-1 min-w-[120px] flex flex-col gap-1 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-xs text-slate-400">{pct}%</span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-lg font-bold text-slate-900 leading-none">{stats.orders}</span>
                      <span className="text-[10px] text-slate-400">£{stats.revenue.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex gap-2 text-[10px] text-slate-400">
                      <span><span className="font-semibold text-yellow-600">{stats.pending}</span> pend</span>
                      <span><span className="font-semibold text-purple-600">{stats.shipped}</span> ship</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status breakdown — hidden for comms-only users */}
      {!isCommsOnly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {(Object.keys(ORDER_STATUS_CONFIG) as OrderStatus[]).map(
                (status) => {
                  const config = ORDER_STATUS_CONFIG[status];
                  const Icon = statusIcons[status];
                  const count = statusCounts[status] || 0;
                  return (
                    <div
                      key={status}
                      className={`flex flex-col items-center p-3 rounded-lg border cursor-pointer hover:opacity-80 transition-opacity ${config.color}`}
                      onClick={() => router.push(`/orders?status=${status}`)}
                    >
                      <Icon className="h-5 w-5 mb-1" />
                      <span className="text-lg font-bold">{count}</span>
                      <span className="text-xs">{config.label}</span>
                    </div>
                  );
                }
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent batches — hidden for comms-only users */}
      {!isCommsOnly && batches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Imports</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {batches
                .slice(-5)
                .reverse()
                .map((batch) => (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between p-3 bg-slate-100 rounded-lg"
                  >
                    <div>
                      <p className="text-sm font-medium">{batch.name}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(batch.importedAt).toLocaleString()} •{' '}
                        {batch.source.toUpperCase()}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-slate-600">
                      {batch.orderCount} orders
                    </span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!isCommsOnly && orders.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-slate-300 mb-4" />
            <h3 className="text-lg font-medium text-slate-600">No orders yet</h3>
            <p className="text-sm text-slate-400 mt-1">
              Import a CSV file to get started
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
