'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { ORDER_STATUS_CONFIG, OrderStatus } from '@/lib/types';
import { getOrderRowClass } from '@/lib/order-utils';
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
interface MsgRow { id: string; direction: string; status: string; message_text: string; buyer_username: string; sent_at: string; buyer_name?: string; item_title?: string; }

export function Dashboard() {
  const router = useRouter();
  const orders = useOrderStore((s) => s.orders);
  const batches = useOrderStore((s) => s.batches);
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const currentUser = users.find((u) => u.id === currentUserId);
  const isCommsOnly = currentUser?.role === 'comms' || currentUser?.roles?.includes('comms') || currentUser?.department === 'comms' || currentUser?.departments?.includes('comms');
  const [msgCounts, setMsgCounts] = useState<MsgCount[]>([]);
  const [unreadMessages, setUnreadMessages] = useState<MsgRow[]>([]);
  const [oldestUnread, setOldestUnread] = useState<MsgRow | null>(null);
  const [postByFilter, setPostByFilter] = useState<string>('');
  const [sortField, setSortField] = useState<'postByDate' | 'priority' | 'salesRecordNumber' | 'itemTitle'>('postByDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    async function loadMsgCounts() {
      try {
        const res = await fetch('/api/ebay/messages/inbox');
        if (!res.ok) return;
        const { messages } = await res.json() as { messages: MsgRow[] };
        const received = messages.filter(m => m.direction === 'received');
        const unread   = received.filter(m => m.status === 'unread');
        if (received.length > 0) {
          setMsgCounts([{ platform: 'ebay', unread: unread.length, total: received.length }]);
        }
        setUnreadMessages(unread);
        if (unread.length > 0) {
          const oldest = [...unread].sort((a, b) => a.sent_at.localeCompare(b.sent_at))[0];
          setOldestUnread(oldest);
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
  const shippedCount = statusCounts['shipped'] || 0;
  const totalUnread  = msgCounts.reduce((s, m) => s + m.unread, 0);

  // Awaiting Action = statuses that require warehouse work
  const ACTION_STATUSES: OrderStatus[] = ['pending', 'assembling', 'checking', 'packing'];
  const awaitingOrders = useMemo(() => {
    let filtered = orders.filter(o => ACTION_STATUSES.includes(o.status));
    if (postByFilter) {
      filtered = filtered.filter(o => o.postByDate && o.postByDate.slice(0, 10) <= postByFilter);
    }
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'postByDate': {
          const aDate = new Date(a.postByDate || a.saleDate).getTime();
          const bDate = new Date(b.postByDate || b.saleDate).getTime();
          comparison = aDate - bDate;
          break;
        }
        case 'priority':
          comparison = a.priority - b.priority;
          break;
        case 'salesRecordNumber':
          comparison = a.salesRecordNumber.localeCompare(b.salesRecordNumber);
          break;
        case 'itemTitle':
          comparison = a.itemTitle.localeCompare(b.itemTitle);
          break;
      }
      return sortDir === 'asc' ? comparison : -comparison;
    });
    return filtered;
  }, [orders, postByFilter, sortField, sortDir]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const overdueCount = awaitingOrders.filter(o => o.postByDate && o.postByDate.slice(0, 10) < todayStr).length;
  const dueTodayCount = awaitingOrders.filter(o => o.postByDate && o.postByDate.slice(0, 10) === todayStr).length;

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIndicator = (field: typeof sortField) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          {isCommsOnly ? 'Comms Dashboard' : 'Dashboard'}
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          {isCommsOnly ? 'Buyer messages awaiting action' : 'Overview of your warehouse pipeline'}
        </p>
      </div>

      {/* Summary cards — hidden for comms-only users */}
      {!isCommsOnly && (
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
              {awaitingOrders.length}
            </div>
            <div className="flex gap-2 mt-1">
              {overdueCount > 0 && (
                <span className="text-xs font-semibold text-red-600">{overdueCount} overdue</span>
              )}
              {dueTodayCount > 0 && (
                <span className="text-xs font-semibold text-amber-600">{dueTodayCount} due today</span>
              )}
              {overdueCount === 0 && dueTodayCount === 0 && (
                <span className="text-xs text-slate-500">Need packaging &amp; dispatch</span>
              )}
            </div>
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
      )}

      {/* Post-by date filter + Awaiting Action table — hidden for comms-only users */}
      {!isCommsOnly && (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-yellow-500" />
            Awaiting Action
            <span className="text-sm font-normal text-slate-500">({awaitingOrders.length})</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Post by ≤</label>
            <input
              type="date"
              value={postByFilter}
              onChange={e => setPostByFilter(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
            {postByFilter && (
              <button onClick={() => setPostByFilter('')} className="text-xs text-slate-400 hover:text-slate-600">✕ clear</button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {awaitingOrders.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">
              {postByFilter ? 'No orders due on or before that date.' : 'No orders awaiting action.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="text-left px-4 py-2 font-medium text-slate-500 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('salesRecordNumber')}>Order #{sortIndicator('salesRecordNumber')}</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-500 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('itemTitle')}>Item {sortIndicator('itemTitle')}</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-500">Status</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-500 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('postByDate')}>Post By{sortIndicator('postByDate')}</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-500 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('priority')}>Priority{sortIndicator('priority')}</th>
                  </tr>
                </thead>
                <tbody>
                  {awaitingOrders.slice(0, 20).map(o => {
                    const isOverdue = o.postByDate && o.postByDate.slice(0, 10) < todayStr;
                    const isDueToday = o.postByDate && o.postByDate.slice(0, 10) === todayStr;
                    return (
                      <tr
                        key={o.id}
                        className={`border-b hover:bg-slate-50 cursor-pointer ${getOrderRowClass(o)}`}
                        onClick={() => router.push(`/orders?search=${o.salesRecordNumber}`)}
                      >
                        <td className="px-4 py-2 font-mono">{o.salesRecordNumber}</td>
                        <td className="px-4 py-2 max-w-[200px] truncate">{o.itemTitle}</td>
                        <td className="px-4 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${ORDER_STATUS_CONFIG[o.status]?.color ?? ''}`}>
                            {ORDER_STATUS_CONFIG[o.status]?.label ?? o.status}
                          </span>
                        </td>
                        <td className={`px-4 py-2 font-medium ${
                          isOverdue ? 'text-red-600' : isDueToday ? 'text-amber-600' : 'text-slate-700'
                        }`}>
                          {o.postByDate ? o.postByDate.slice(0, 10) : '—'}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`font-bold ${
                            o.priority <= 2 ? 'text-red-600' : o.priority <= 3 ? 'text-amber-600' : 'text-slate-500'
                          }`}>P{o.priority}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {awaitingOrders.length > 20 && (
                <p className="text-xs text-center text-slate-400 py-2">
                  Showing 20 of {awaitingOrders.length} — <button className="underline" onClick={() => router.push('/orders?status=pending')}>view all</button>
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Comms-only dashboard title */}
      {isCommsOnly && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Buyer Messages Awaiting Action</h3>
          <p className="text-sm text-slate-500">Unread messages that need a response</p>
        </div>
      )}

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
        {isCommsOnly ? (
          <CardContent className="p-0">
            {unreadMessages.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No unread buyer messages.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="text-left px-4 py-2 font-medium text-slate-500">Buyer</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-500">Item</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-500">Message</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-500">Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unreadMessages.slice(0, 50).map((m) => (
                      <tr key={m.id} className="border-b hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <span className="font-semibold text-slate-700">{m.buyer_username}</span>
                          {m.buyer_name && <span className="text-slate-400 ml-1">({m.buyer_name})</span>}
                        </td>
                        <td className="px-4 py-2 max-w-[200px] truncate text-slate-500">{m.item_title || '—'}</td>
                        <td className="px-4 py-2 max-w-[300px] truncate">{m.message_text}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                          {new Date(m.sent_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {unreadMessages.length > 50 && (
                  <p className="text-xs text-center text-slate-400 py-2">
                    Showing 50 of {unreadMessages.length} — <button className="underline" onClick={() => router.push('/notes')}>view all</button>
                  </p>
                )}
              </div>
            )}
          </CardContent>
        ) : (
          <>
            {oldestUnread && (
              <div className="mx-4 -mt-2 mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                <span className="mt-0.5 h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-700 truncate">
                    {oldestUnread.buyer_username}{oldestUnread.buyer_name ? ` (${oldestUnread.buyer_name})` : ''}
                    <span className="font-normal text-slate-400 ml-2">{new Date(oldestUnread.sent_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                  <p className="text-xs text-slate-600 truncate mt-0.5">{oldestUnread.message_text}</p>
                </div>
              </div>
            )}
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
          </>
        )}
      </Card>

      {/* Order Sources — hidden for comms-only users */}
      {!isCommsOnly && sourceEntries.length > 0 && (
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
