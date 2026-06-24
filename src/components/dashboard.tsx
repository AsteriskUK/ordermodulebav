'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
  ShoppingCart,
  Wrench,
  ClipboardCheck,
  BoxSelect,
  PauseCircle,
  PackageOpen,
  Archive,
  Store,
  Inbox,
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

const PLATFORM_STYLES: Record<string, { label: string; bg: string; border: string; badge: string; logo: string }> = {
  ebay:       { label: 'eBay',        bg: 'bg-yellow-50',  border: 'border-yellow-300', badge: 'bg-red-500',    logo: '/ebay.png'       },
  amazon:     { label: 'Amazon',      bg: 'bg-orange-50',  border: 'border-orange-300', badge: 'bg-red-500',    logo: '/amazon.png'     },
  backmarket: { label: 'Back Market', bg: 'bg-green-50',   border: 'border-green-300',  badge: 'bg-red-500',    logo: '/backmarket.svg' },
  onbuy:      { label: 'OnBuy',       bg: 'bg-cyan-50',    border: 'border-cyan-300',   badge: 'bg-red-500',    logo: '/onbuy.svg'      },
  temu:       { label: 'Temu',        bg: 'bg-rose-50',    border: 'border-rose-300',   badge: 'bg-red-500',    logo: '/temu.png'       },
};

interface MsgCount { platform: string; unread: number; total: number; }

export function Dashboard() {
  const router = useRouter();
  const orders = useOrderStore((s) => s.orders);
  const batches = useOrderStore((s) => s.batches);
  const [msgCounts, setMsgCounts] = useState<MsgCount[]>([]);

  useEffect(() => {
    async function loadMsgCounts() {
      try {
        const res = await fetch('/api/ebay/messages/inbox');
        if (!res.ok) return;
        const { messages } = await res.json() as { messages: Array<{ direction: string; status: string }> };
        const ebayUnread = messages.filter(m => m.direction === 'received' && m.status === 'unread').length;
        const ebayTotal  = messages.filter(m => m.direction === 'received').length;
        if (ebayTotal > 0 || ebayUnread > 0) {
          setMsgCounts([{ platform: 'ebay', unread: ebayUnread, total: ebayTotal }]);
        }
      } catch { /* silent */ }
    }
    loadMsgCounts();
  }, []);

  const statusCounts = orders.reduce(
    (acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // ── Per-source stats ────────────────────────────────────────────
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

  // Largest-remainder method: percentages guaranteed to sum to 100
  const _total = orders.length || 1;
  const sourceEntries = Object.entries(sourceStats)
    .sort((a, b) => b[1].orders - a[1].orders)
    .map(([src, stats]) => ({
      src,
      stats,
      pct: Math.floor((stats.orders / _total) * 100),
      rem: ((stats.orders / _total) * 100) % 1,
    }));
  const _remainder = 100 - sourceEntries.reduce((s, e) => s + e.pct, 0);
  sourceEntries
    .slice()
    .sort((a, b) => b.rem - a.rem)
    .forEach((e, i) => { if (i < _remainder) e.pct += 1; });

  const totalRevenue = orders.reduce((sum, o) => sum + o.soldFor, 0);
  const pendingCount = statusCounts['pending'] || 0;
  const shippedCount = statusCounts['shipped'] || 0;
  const totalUnread  = msgCounts.reduce((s, m) => s + m.unread, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
        <p className="text-slate-500 text-sm mt-1">
          Overview of your warehouse pipeline
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/orders')}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Total Orders
            </CardTitle>
            <ShoppingCart className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{orders.length}</div>
            <p className="text-xs text-slate-500 mt-1">
              {batches.length} batch{batches.length !== 1 ? 'es' : ''} imported
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/orders?status=pending')}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Awaiting Action
            </CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {pendingCount}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Need packaging & dispatch
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/orders?status=shipped')}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Shipped
            </CardTitle>
            <Truck className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {shippedCount}
            </div>
            <p className="text-xs text-slate-500 mt-1">In transit</p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/orders')}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Total Revenue
            </CardTitle>
            <span className="text-slate-400 text-sm font-bold">£</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              £{totalRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-slate-500 mt-1">From all orders</p>
          </CardContent>
        </Card>
      </div>

      {/* Buyer Messages */}
      <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => router.push('/notes')}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base flex items-center gap-2 text-slate-900">
            <Inbox className="h-4 w-4 text-amber-500" />
            Buyer Messages
            {totalUnread > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5 leading-none">
                {totalUnread} unread
              </span>
            )}
          </CardTitle>
          <span className="text-xs text-slate-400">Click to open inbox</span>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Object.entries(PLATFORM_STYLES).map(([platform, style]) => {
              const counts = msgCounts.find(m => m.platform === platform);
              return (
                <div
                  key={platform}
                  className={`relative rounded-xl border-2 p-4 flex flex-col items-center gap-2 transition-all
                    ${counts ? `${style.bg} ${style.border}` : 'bg-slate-50 border-slate-200 opacity-50'}`}
                >
                  {counts && counts.unread > 0 && (
                    <span className={`absolute -top-2 -right-2 ${style.badge} text-white text-[11px] font-bold rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5 shadow`}>
                      {counts.unread}
                    </span>
                  )}
                  <img src={style.logo} alt={style.label} className="h-8 w-auto object-contain" />
                  <span className="text-xs font-bold text-slate-900">{style.label}</span>
                  {counts ? (
                    <div className="text-center">
                      <p className="text-lg font-bold leading-none text-slate-900">{counts.total}</p>
                      <p className="text-[11px] text-slate-700 mt-0.5 font-medium">
                        {counts.unread > 0 ? `${counts.unread} unread` : 'all read'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">not connected</p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Order Sources */}
      {sourceEntries.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Order Sources</CardTitle>
            <Store className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {sourceEntries.map(({ src, stats, pct }) => {
                const cfg = SOURCE_CONFIG[src] ?? { label: src, color: 'text-slate-700', bg: 'bg-slate-50 border-slate-200', bar: 'bg-slate-400' };
                return (
                  <div
                    key={src}
                    className={`rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow ${cfg.bg}`}
                    onClick={() => router.push(`/orders?source=${src}`)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-bold uppercase tracking-wide ${cfg.color}`}>{cfg.label}</span>
                      <span className={`text-xs font-semibold ${cfg.color}`}>{Math.round((stats.orders / _total) * 100)}%</span>
                    </div>
                    <div className="text-2xl font-bold text-slate-900 mb-1">{stats.orders}</div>
                    <div className="text-xs text-slate-500 mb-3">orders &nbsp;·&nbsp; £{stats.revenue.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                    <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mb-3">
                      <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span><span className="font-medium text-yellow-600">{stats.pending}</span> pending</span>
                      <span><span className="font-medium text-purple-600">{stats.shipped}</span> shipped</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status breakdown */}
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

      {/* Recent batches */}
      {batches.length > 0 && (
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

      {orders.length === 0 && (
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
