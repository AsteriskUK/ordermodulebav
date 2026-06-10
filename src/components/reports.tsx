'use client';

import { useState, useMemo } from 'react';
import { useOrderStore } from '@/lib/store';
import { ORDER_STATUS_CONFIG, OrderStatus } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { BarChart2, TrendingUp, Users, Package, Download, Target } from 'lucide-react';

type ReportTab = 'revenue' | 'productivity' | 'categories' | 'returns' | 'targets';

function formatCurrency(n: number) {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateRange(from: string, to: string) {
  const f = from ? new Date(from) : null;
  const t = to ? new Date(to + 'T23:59:59') : null;
  return (d: string) => {
    const dt = new Date(d);
    if (f && dt < f) return false;
    if (t && dt > t) return false;
    return true;
  };
}

export function Reports() {
  const orders = useOrderStore((s) => s.orders);
  const eodEvents = useOrderStore((s) => s.eodEvents);
  const returns = useOrderStore((s) => s.returns);
  const users = useOrderStore((s) => s.users);
  const updateUser = useOrderStore((s) => s.updateUser);

  const [tab, setTab] = useState<ReportTab>('revenue');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [editTargetUserId, setEditTargetUserId] = useState<string | null>(null);
  const [editTargetAction, setEditTargetAction] = useState<OrderStatus>('assembling');
  const [editTargetValue, setEditTargetValue] = useState('');

  const inRange = useMemo(() => dateRange(fromDate, toDate), [fromDate, toDate]);

  // ── REVENUE ────────────────────────────────────────────────────
  const revenueOrders = useMemo(
    () => orders.filter((o) => inRange(o.saleDate) && o.status !== 'cancelled' && o.status !== 'refunded' && o.status !== 'returned'),
    [orders, inRange]
  );

  const totalRevenue = revenueOrders.reduce((s, o) => s + o.soldFor, 0);
  const totalShipped = revenueOrders.filter((o) => o.status === 'shipped' || o.status === 'delivered').length;

  const revenueByDate = useMemo(() => {
    const map: Record<string, { revenue: number; count: number }> = {};
    for (const o of revenueOrders) {
      const d = o.saleDate.slice(0, 10);
      if (!map[d]) map[d] = { revenue: 0, count: 0 };
      map[d].revenue += o.soldFor;
      map[d].count += 1;
    }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a)).slice(0, 30);
  }, [revenueOrders]);

  const revenueByCarrier = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of revenueOrders) {
      const c = o.deliveryCarrier || 'Unknown';
      map[c] = (map[c] || 0) + o.soldFor;
    }
    return Object.entries(map).sort(([, a], [, b]) => b - a);
  }, [revenueOrders]);

  // ── PRODUCTIVITY ───────────────────────────────────────────────
  const productivityData = useMemo(() => {
    const filtered = eodEvents.filter((e) => inRange(e.changedAt));
    return users.map((user) => {
      const userEvents = filtered.filter((e) => e.userId === user.id);
      const byAction: Record<string, number> = {};
      for (const e of userEvents) {
        byAction[e.toStatus] = (byAction[e.toStatus] || 0) + 1;
      }
      return {
        user,
        total: userEvents.length,
        byAction,
        lastActive: userEvents.length
          ? userEvents.sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0].changedAt
          : null,
      };
    }).sort((a, b) => b.total - a.total);
  }, [eodEvents, users, inRange]);

  // ── CATEGORIES ─────────────────────────────────────────────────
  const categoryData = useMemo(() => {
    const filtered = revenueOrders;
    const map: Record<string, { count: number; revenue: number }> = {};
    for (const o of filtered) {
      const c = o.category || 'Uncategorised';
      if (!map[c]) map[c] = { count: 0, revenue: 0 };
      map[c].count += 1;
      map[c].revenue += o.soldFor;
    }
    return Object.entries(map).sort(([, a], [, b]) => b.revenue - a.revenue);
  }, [revenueOrders]);

  // ── RETURNS ────────────────────────────────────────────────────
  const returnData = useMemo(() => {
    const filtered = returns.filter((r) => inRange(r.returnedAt));
    const byReason: Record<string, number> = {};
    const byUser: Record<string, { name: string; count: number; refunded: number }> = {};
    for (const r of filtered) {
      byReason[r.reason] = (byReason[r.reason] || 0) + 1;
      const uid = r.processedByUserId || 'unknown';
      if (!byUser[uid]) byUser[uid] = { name: r.processedByUserName || 'Unknown', count: 0, refunded: 0 };
      byUser[uid].count += 1;
      if (r.status === 'refunded') byUser[uid].refunded += r.refundAmount || 0;
    }
    return {
      total: filtered.length,
      refunded: filtered.filter((r) => r.status === 'refunded').length,
      totalRefunded: filtered.filter((r) => r.status === 'refunded').reduce((s, r) => s + (r.refundAmount || 0), 0),
      byReason: Object.entries(byReason).sort(([, a], [, b]) => b - a),
      byUser: Object.values(byUser).sort((a, b) => b.count - a.count),
    };
  }, [returns, inRange]);

  // ── TARGETS ────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayEvents = useMemo(
    () => eodEvents.filter((e) => e.changedAt.slice(0, 10) === todayStr),
    [eodEvents, todayStr]
  );

  const saveTarget = () => {
    const user = users.find((u) => u.id === editTargetUserId);
    if (!user) return;
    const existing = (user.targets || []).filter((t) => t.action !== editTargetAction);
    const dailyTarget = parseInt(editTargetValue, 10);
    if (isNaN(dailyTarget) || dailyTarget < 1) return;
    updateUser(user.id, { targets: [...existing, { action: editTargetAction, dailyTarget }] });
    setEditTargetUserId(null);
    setEditTargetValue('');
  };

  const exportCSV = () => {
    let csv = '';
    if (tab === 'revenue') {
      csv = ['Date,Orders,Revenue', ...revenueByDate.map(([d, v]) => `${d},${v.count},${v.revenue.toFixed(2)}`)].join('\n');
    } else if (tab === 'productivity') {
      csv = ['User,Department,Total Actions', ...productivityData.map((p) => `${p.user.name},${p.user.department},${p.total}`)].join('\n');
    } else if (tab === 'categories') {
      csv = ['Category,Orders,Revenue', ...categoryData.map(([c, v]) => `"${c}",${v.count},${v.revenue.toFixed(2)}`)].join('\n');
    } else if (tab === 'returns') {
      csv = ['Reason,Count', ...returnData.byReason.map(([r, c]) => `"${r}",${c}`)].join('\n');
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${tab}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const TABS: { id: ReportTab; label: string; icon: React.ElementType }[] = [
    { id: 'revenue', label: 'Revenue', icon: TrendingUp },
    { id: 'productivity', label: 'Productivity', icon: Users },
    { id: 'categories', label: 'Categories', icon: Package },
    { id: 'returns', label: 'Returns', icon: BarChart2 },
    { id: 'targets', label: 'Targets', icon: Target },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Reports</h2>
          <p className="text-slate-500 text-sm mt-1">Revenue, productivity, categories and returns analysis</p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCSV}>
          <Download className="h-3 w-3 mr-1" />
          Export CSV
        </Button>
      </div>

      {/* Date range */}
      <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border">
        <span className="text-xs font-medium text-slate-500">Date Range:</span>
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-7 text-xs w-36" />
        <span className="text-xs text-slate-400">to</span>
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-7 text-xs w-36" />
        {(fromDate || toDate) && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setFromDate(''); setToDate(''); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === id ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── REVENUE TAB ──────────────────────────────────────── */}
      {tab === 'revenue' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-5">
              <div className="text-2xl font-bold text-green-700">{formatCurrency(totalRevenue)}</div>
              <p className="text-xs text-slate-500 mt-1">Total Revenue</p>
            </CardContent></Card>
            <Card><CardContent className="pt-5">
              <div className="text-2xl font-bold">{revenueOrders.length}</div>
              <p className="text-xs text-slate-500 mt-1">Orders</p>
            </CardContent></Card>
            <Card><CardContent className="pt-5">
              <div className="text-2xl font-bold text-purple-600">{totalShipped}</div>
              <p className="text-xs text-slate-500 mt-1">Shipped</p>
            </CardContent></Card>
            <Card><CardContent className="pt-5">
              <div className="text-2xl font-bold">{formatCurrency(revenueOrders.length ? totalRevenue / revenueOrders.length : 0)}</div>
              <p className="text-xs text-slate-500 mt-1">Avg Order Value</p>
            </CardContent></Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Revenue by Day</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Orders</TableHead>
                    <TableHead className="text-xs">Revenue</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {revenueByDate.map(([date, v]) => (
                      <TableRow key={date}>
                        <TableCell className="text-xs">{new Date(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</TableCell>
                        <TableCell className="text-xs">{v.count}</TableCell>
                        <TableCell className="text-xs font-medium">{formatCurrency(v.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Revenue by Carrier</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {revenueByCarrier.map(([carrier, rev]) => {
                    const pct = totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0;
                    return (
                      <div key={carrier}>
                        <div className="flex justify-between text-xs mb-1">
                          <span>{carrier}</span>
                          <span className="font-medium">{formatCurrency(rev)} ({pct.toFixed(0)}%)</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── PRODUCTIVITY TAB ─────────────────────────────────── */}
      {tab === 'productivity' && (
        <Card>
          <CardHeader><CardTitle className="text-sm">User Activity ({eodEvents.filter((e) => inRange(e.changedAt)).length} total actions)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow className="bg-slate-50">
                <TableHead className="text-xs">User</TableHead>
                <TableHead className="text-xs">Dept</TableHead>
                <TableHead className="text-xs">Total</TableHead>
                {(['assembling', 'checking', 'packing', 'packed', 'shipped', 'held'] as OrderStatus[]).map((s) => (
                  <TableHead key={s} className="text-xs">{ORDER_STATUS_CONFIG[s].label}</TableHead>
                ))}
                <TableHead className="text-xs">Last Active</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {productivityData.map(({ user, total, byAction, lastActive }) => (
                  <TableRow key={user.id}>
                    <TableCell className="text-xs font-medium">{user.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs capitalize">{user.department}</Badge></TableCell>
                    <TableCell className="text-xs font-bold">{total}</TableCell>
                    {(['assembling', 'checking', 'packing', 'packed', 'shipped', 'held'] as OrderStatus[]).map((s) => (
                      <TableCell key={s} className="text-xs">{byAction[s] || 0}</TableCell>
                    ))}
                    <TableCell className="text-xs text-slate-400">
                      {lastActive ? new Date(lastActive).toLocaleDateString('en-GB') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
                {productivityData.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center text-slate-400 text-xs py-6">No activity recorded</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── CATEGORIES TAB ───────────────────────────────────── */}
      {tab === 'categories' && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Revenue by Category</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow className="bg-slate-50">
                <TableHead className="text-xs">Category</TableHead>
                <TableHead className="text-xs">Orders</TableHead>
                <TableHead className="text-xs">Revenue</TableHead>
                <TableHead className="text-xs">Share</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {categoryData.map(([cat, v]) => {
                  const pct = totalRevenue > 0 ? (v.revenue / totalRevenue) * 100 : 0;
                  return (
                    <TableRow key={cat}>
                      <TableCell className="text-xs font-medium">{cat}</TableCell>
                      <TableCell className="text-xs">{v.count}</TableCell>
                      <TableCell className="text-xs font-medium">{formatCurrency(v.revenue)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-slate-500">{pct.toFixed(1)}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {categoryData.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-slate-400 text-xs py-6">No data</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── RETURNS TAB ──────────────────────────────────────── */}
      {tab === 'returns' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card><CardContent className="pt-5">
              <div className="text-2xl font-bold text-rose-600">{returnData.total}</div>
              <p className="text-xs text-slate-500 mt-1">Total Returns</p>
            </CardContent></Card>
            <Card><CardContent className="pt-5">
              <div className="text-2xl font-bold text-green-600">{returnData.refunded}</div>
              <p className="text-xs text-slate-500 mt-1">Refunded</p>
            </CardContent></Card>
            <Card><CardContent className="pt-5">
              <div className="text-2xl font-bold text-orange-600">{formatCurrency(returnData.totalRefunded)}</div>
              <p className="text-xs text-slate-500 mt-1">Total Refunded Value</p>
            </CardContent></Card>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Returns by Reason</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {returnData.byReason.map(([reason, count]) => (
                    <div key={reason} className="flex justify-between items-center text-xs p-2 bg-slate-50 rounded">
                      <span>{reason}</span>
                      <Badge variant="outline">{count}</Badge>
                    </div>
                  ))}
                  {returnData.byReason.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No returns in range</p>}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Returns by Staff</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-xs">Staff</TableHead>
                    <TableHead className="text-xs">Logged</TableHead>
                    <TableHead className="text-xs">Refunded</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {returnData.byUser.map((u) => (
                      <TableRow key={u.name}>
                        <TableCell className="text-xs">{u.name}</TableCell>
                        <TableCell className="text-xs">{u.count}</TableCell>
                        <TableCell className="text-xs">{formatCurrency(u.refunded)}</TableCell>
                      </TableRow>
                    ))}
                    {returnData.byUser.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-slate-400 text-xs py-4">No data</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── TARGETS TAB ──────────────────────────────────────── */}
      {tab === 'targets' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">Set daily targets per user per action. Progress shown for today.</p>
          {users.map((user) => {
            const userEvents = todayEvents.filter((e) => e.userId === user.id);
            return (
              <Card key={user.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{user.name}
                      <Badge variant="outline" className="ml-2 text-xs capitalize">{user.department}</Badge>
                    </CardTitle>
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => { setEditTargetUserId(editTargetUserId === user.id ? null : user.id); }}>
                      {editTargetUserId === user.id ? 'Done' : 'Set Target'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {editTargetUserId === user.id && (
                    <div className="flex gap-2 mb-3 p-2 bg-slate-50 rounded">
                      <Select value={editTargetAction} onValueChange={(v) => v && setEditTargetAction(v as OrderStatus)}>
                        <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(['assembling','checking','packing','packed','shipped'] as OrderStatus[]).map((s) => (
                            <SelectItem key={s} value={s}>{ORDER_STATUS_CONFIG[s].label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input value={editTargetValue} onChange={(e) => setEditTargetValue(e.target.value)}
                        placeholder="Daily target" className="h-7 text-xs w-24" type="number" min="1" />
                      <Button size="sm" className="h-7 text-xs" onClick={saveTarget}>Save</Button>
                    </div>
                  )}
                  {(user.targets || []).length === 0 ? (
                    <p className="text-xs text-slate-400">No targets set</p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {(user.targets || []).map((target) => {
                        const done = userEvents.filter((e) => e.toStatus === target.action).length;
                        const pct = Math.min(100, (done / target.dailyTarget) * 100);
                        const cfg = ORDER_STATUS_CONFIG[target.action];
                        return (
                          <div key={target.action} className={`p-3 rounded-lg border ${cfg.color}`}>
                            <p className="text-xs font-medium">{cfg.label}</p>
                            <p className="text-lg font-bold">{done} <span className="text-xs font-normal opacity-70">/ {target.dailyTarget}</span></p>
                            <div className="h-1.5 bg-white/50 rounded-full mt-2 overflow-hidden">
                              <div className="h-full bg-current rounded-full opacity-70" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
