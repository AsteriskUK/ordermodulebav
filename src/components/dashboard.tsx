'use client';

import Image from 'next/image';
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

// Border accent colour per status (left border strip)
const STATUS_ACCENT: Record<OrderStatus, string> = {
  pending:    'border-l-yellow-400',
  assembling: 'border-l-amber-400',
  checking:   'border-l-cyan-400',
  packing:    'border-l-indigo-400',
  packed:     'border-l-blue-400',
  shipped:    'border-l-purple-500',
  delivered:  'border-l-green-500',
  held:       'border-l-red-500',
  'no-stock': 'border-l-orange-400',
  cancelled:  'border-l-gray-400',
  refunded:   'border-l-orange-500',
  returned:   'border-l-rose-500',
  archived:   'border-l-slate-400',
};

// Pipeline stages shown prominently; terminal states shown smaller below
const PIPELINE: OrderStatus[] = ['pending', 'assembling', 'checking', 'packing', 'packed', 'shipped'];
const TERMINAL: OrderStatus[] = ['delivered', 'held', 'no-stock', 'cancelled', 'refunded', 'returned', 'archived'];

const SOURCE_CONFIG: Record<string, { label: string; logo?: string; color: string; bg: string; bar: string; badge: string }> = {
  ebay:       { label: 'eBay',        logo: '/ebay.png',       color: 'text-yellow-700', bg: 'bg-yellow-50',  bar: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-800' },
  backmarket: { label: 'Back Market', logo: '/backmarket.svg', color: 'text-green-700',  bg: 'bg-green-50',   bar: 'bg-green-500',  badge: 'bg-green-100 text-green-800'  },
  amazon:     { label: 'Amazon',      logo: '/amazon.png',     color: 'text-orange-700', bg: 'bg-orange-50',  bar: 'bg-orange-400', badge: 'bg-orange-100 text-orange-800' },
  temu:       { label: 'Temu',        logo: '/Temu.png',       color: 'text-rose-700',   bg: 'bg-rose-50',    bar: 'bg-rose-400',   badge: 'bg-rose-100 text-rose-800'    },
  onbuy:      { label: 'OnBuy',       logo: '/onbuy.svg',      color: 'text-cyan-700',   bg: 'bg-cyan-50',    bar: 'bg-cyan-400',   badge: 'bg-cyan-100 text-cyan-800'    },
  manual:     { label: 'Manual',      color: 'text-blue-700',  bg: 'bg-blue-50',         bar: 'bg-blue-400',  badge: 'bg-blue-100 text-blue-800'  },
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

      {/* Order Sources — compact row with logos */}
      {!isCommsOnly && sourceEntries.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex divide-x divide-slate-100 overflow-x-auto">
              {sourceEntries.map(({ src, stats, pct }) => {
                const cfg = SOURCE_CONFIG[src] ?? { label: src, color: 'text-slate-700', bg: 'bg-slate-50', bar: 'bg-slate-400', badge: 'bg-slate-100 text-slate-700' };
                return (
                  <button
                    key={src}
                    onClick={() => router.push(`/orders?source=${src}`)}
                    className={`flex-1 min-w-[130px] flex flex-col gap-1.5 px-4 py-3 hover:brightness-95 transition-all text-left ${cfg.bg}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {cfg.logo && (
                          <Image src={cfg.logo} alt={cfg.label} width={16} height={16} className="object-contain rounded-sm shrink-0" style={{ maxHeight: 16 }} />
                        )}
                        <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
                      </div>
                      <span className="text-xs text-slate-400 font-medium">{pct}%</span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xl font-extrabold text-slate-900 leading-none">{stats.orders}</span>
                      <span className="text-[10px] text-slate-500">£{stats.revenue.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div className="w-full h-1.5 bg-white/60 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex gap-2 text-[10px]">
                      <span className="font-semibold text-amber-600">{stats.pending} pend</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-semibold text-purple-600">{stats.shipped} ship</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status breakdown */}
      {!isCommsOnly && (
        <div className="space-y-3">
          {/* Pipeline stages — large cards */}
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-0.5">Pipeline</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {PIPELINE.map((status) => {
              const config = ORDER_STATUS_CONFIG[status];
              const Icon = statusIcons[status];
              const count = statusCounts[status] || 0;
              const accent = STATUS_ACCENT[status];
              return (
                <button
                  key={status}
                  onClick={() => router.push(`/orders?status=${status}`)}
                  className={`relative overflow-hidden flex flex-col gap-1 p-4 rounded-xl border bg-white border-l-4 ${accent} shadow-sm hover:shadow-md transition-all text-left`}
                >
                  <Icon className="absolute right-3 top-3 h-8 w-8 opacity-[0.07] text-slate-900" />
                  <span className={`text-3xl font-black leading-none ${count > 0 ? 'text-slate-900' : 'text-slate-300'}`}>{count}</span>
                  <span className="text-xs font-semibold text-slate-500 mt-1">{config.label}</span>
                  <Icon className={`h-4 w-4 mt-0.5 ${count > 0 ? config.color.split(' ')[1] : 'text-slate-300'}`} />
                </button>
              );
            })}
          </div>

          {/* Terminal states — smaller, muted */}
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-0.5 pt-1">Completed &amp; Other</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {TERMINAL.map((status) => {
              const config = ORDER_STATUS_CONFIG[status];
              const Icon = statusIcons[status];
              const count = statusCounts[status] || 0;
              return (
                <button
                  key={status}
                  onClick={() => router.push(`/orders?status=${status}`)}
                  className={`flex flex-col items-center gap-0.5 p-3 rounded-lg border cursor-pointer hover:opacity-80 transition-opacity ${config.color}`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-base font-bold leading-tight">{count}</span>
                  <span className="text-[10px] leading-tight text-center">{config.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent batches */}
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
                .map((batch) => {
                  const cfg = SOURCE_CONFIG[batch.source] ?? { label: batch.source, badge: 'bg-slate-100 text-slate-700' };
                  const logo = cfg.logo;
                  return (
                    <div
                      key={batch.id}
                      className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        {logo ? (
                          <Image src={logo} alt={cfg.label} width={20} height={20} className="object-contain rounded-sm shrink-0" style={{ maxHeight: 20 }} />
                        ) : (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cfg.badge}`}>{cfg.label.slice(0,2).toUpperCase()}</span>
                        )}
                        <div>
                          <p className="text-sm font-medium text-slate-800">{batch.name}</p>
                          <p className="text-xs text-slate-400">{new Date(batch.importedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</p>
                        </div>
                      </div>
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${cfg.badge}`}>{batch.orderCount} orders</span>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {!isCommsOnly && orders.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-slate-300 mb-4" />
            <h3 className="text-lg font-medium text-slate-600">No orders yet</h3>
            <p className="text-sm text-slate-400 mt-1">Import a CSV file to get started</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
