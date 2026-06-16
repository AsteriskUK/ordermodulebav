'use client';

import { useState, useMemo } from 'react';
import { useOrderStore } from '@/lib/store';
import { ReturnRecord } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { PackageOpen, Plus, Search, CheckCircle, XCircle, Truck } from 'lucide-react';
import { toast } from 'sonner';

const RETURN_REASONS = [
  'Faulty / Not working',
  'Wrong item sent',
  'Item not as described',
  'Changed mind',
  'Damaged in transit',
  'Missing parts / accessories',
  'Buyer remorse',
  'Other',
];

const STATUS_CONFIG: Record<ReturnRecord['status'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  received: { label: 'Received', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  refunded: { label: 'Refunded', color: 'bg-green-100 text-green-800 border-green-300' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 border-red-300' },
  replacement: { label: 'Replacement', color: 'bg-purple-100 text-purple-800 border-purple-300' },
};

function genId() {
  return `ret-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
}

export function ReturnsManager() {
  const orders = useOrderStore((s) => s.orders);
  const returns = useOrderStore((s) => s.returns);
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const addReturn = useOrderStore((s) => s.addReturn);
  const updateReturn = useOrderStore((s) => s.updateReturn);

  const currentUser = users.find((u) => u.id === currentUserId);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);

  // New return form
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [reason, setReason] = useState(RETURN_REASONS[0]);
  const [notes, setNotes] = useState('');
  const [refundAmount, setRefundAmount] = useState('');

  const orderSuggestions = useMemo(() => {
    if (!orderSearch.trim()) return [];
    const q = orderSearch.toLowerCase();
    return orders
      .filter((o) =>
        o.salesRecordNumber.toLowerCase().includes(q) ||
        o.postToName.toLowerCase().includes(q) ||
        o.itemTitle.toLowerCase().includes(q) ||
        o.buyerUsername.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [orders, orderSearch]);

  const filteredReturns = useMemo(() => {
    let r = [...returns].sort((a, b) => b.returnedAt.localeCompare(a.returnedAt));
    if (statusFilter !== 'all') r = r.filter((x) => x.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (x) =>
          x.salesRecordNumber.toLowerCase().includes(q) ||
          x.orderNumber.toLowerCase().includes(q) ||
          x.buyerUsername.toLowerCase().includes(q) ||
          x.itemTitle.toLowerCase().includes(q) ||
          x.reason.toLowerCase().includes(q) ||
          (x.processedByUserName || '').toLowerCase().includes(q)
      );
    }
    return r;
  }, [returns, statusFilter, search]);

  const selectedOrder = orders.find((o) => o.id === selectedOrderId);

  const handleSubmit = () => {
    if (!selectedOrderId) { toast.error('Select an order'); return; }
    const order = orders.find((o) => o.id === selectedOrderId);
    if (!order) return;
    const ret: ReturnRecord = {
      id: genId(),
      orderId: selectedOrderId,
      salesRecordNumber: order.salesRecordNumber,
      orderNumber: order.orderNumber,
      buyerUsername: order.buyerUsername,
      itemTitle: order.itemTitle,
      reason,
      notes,
      returnedAt: new Date().toISOString(),
      processedByUserId: currentUser?.id,
      processedByUserName: currentUser?.name,
      refundAmount: refundAmount ? parseFloat(refundAmount) : undefined,
      status: 'pending',
    };
    addReturn(ret);
    toast.success(`Return logged for order #${order.salesRecordNumber}`);
    setShowForm(false);
    setOrderSearch('');
    setSelectedOrderId('');
    setNotes('');
    setRefundAmount('');
    setReason(RETURN_REASONS[0]);
  };

  const totalRefunded = returns
    .filter((r) => r.status === 'refunded')
    .reduce((s, r) => s + (r.refundAmount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Returns &amp; Refunds</h2>
          <p className="text-slate-500 text-sm mt-1">Track and process customer returns</p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-3 w-3 mr-1" />
          Log Return
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(['pending', 'received', 'refunded', 'rejected'] as ReturnRecord['status'][]).map((s) => {
          const cfg = STATUS_CONFIG[s];
          const count = returns.filter((r) => r.status === s).length;
          return (
            <Card key={s} className="cursor-pointer" onClick={() => setStatusFilter(s)}>
              <CardContent className="pt-5 pb-4">
                <div className={`text-2xl font-bold`}>{count}</div>
                <Badge variant="outline" className={`text-xs mt-1 ${cfg.color}`}>{cfg.label}</Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* New return form */}
      {showForm && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader><CardTitle className="text-sm text-blue-800">Log New Return</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Search Order</label>
              <Input
                value={orderSearch}
                onChange={(e) => { setOrderSearch(e.target.value); setSelectedOrderId(''); }}
                placeholder="Order #, customer name, item..."
                className="h-8 text-sm"
              />
              {orderSuggestions.length > 0 && !selectedOrderId && (
                <div className="border rounded-md mt-1 bg-white shadow-sm divide-y">
                  {orderSuggestions.map((o) => (
                    <button
                      key={o.id}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50"
                      onClick={() => { setSelectedOrderId(o.id); setOrderSearch(`#${o.salesRecordNumber} — ${o.postToName}`); }}
                    >
                      <span className="font-mono text-slate-400 mr-2">#{o.salesRecordNumber}</span>
                      <span className="font-medium">{o.postToName}</span>
                      <span className="text-slate-400 ml-2 truncate">{o.itemTitle.substring(0, 50)}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedOrder && (
                <div className="mt-2 p-2 bg-white rounded border text-xs">
                  <p className="font-medium">{selectedOrder.itemTitle}</p>
                  <p className="text-slate-400">£{selectedOrder.totalPrice.toFixed(2)} • {selectedOrder.postToName} • {selectedOrder.postToPostcode}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Reason</label>
                <Select value={reason} onValueChange={(v) => v && setReason(v)}>
                  <SelectTrigger className="h-8 text-sm w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RETURN_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Refund Amount (£)</label>
                <Input
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder={selectedOrder ? selectedOrder.totalPrice.toFixed(2) : '0.00'}
                  className="h-8 text-sm w-28 font-mono"
                  type="number"
                  step="0.01"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Notes</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional details..."
                className="h-8 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSubmit}>Log Return</Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search returns..." className="pl-8 h-8 text-sm" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-slate-400">Total refunded: <strong className="text-green-700">£{totalRefunded.toFixed(2)}</strong></span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filteredReturns.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <PackageOpen className="h-10 w-10 mx-auto mb-2 text-slate-200" />
              <p>No returns found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Sale #</TableHead>
                  <TableHead className="text-xs">eBay Order #</TableHead>
                  <TableHead className="text-xs">eBay User</TableHead>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                  <TableHead className="text-xs">Refund</TableHead>
                  <TableHead className="text-xs">Processed By</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReturns.map((ret) => (
                  <TableRow key={ret.id}>
                    <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                      {new Date(ret.returnedAt).toLocaleDateString('en-GB')}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{ret.salesRecordNumber}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">{ret.orderNumber || '—'}</TableCell>
                    <TableCell className="text-xs text-slate-600">{ret.buyerUsername || '—'}</TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate">{ret.itemTitle}</TableCell>
                    <TableCell className="text-xs">{ret.reason}</TableCell>
                    <TableCell className="text-xs font-medium">
                      {ret.refundAmount ? `£${ret.refundAmount.toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell className="text-xs">{ret.processedByUserName || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${STATUS_CONFIG[ret.status].color}`}>
                        {STATUS_CONFIG[ret.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {ret.status === 'pending' && (
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                            onClick={() => { updateReturn(ret.id, { status: 'received' }); toast.success('Marked as received'); }}>
                            <Truck className="h-3 w-3 mr-1" />Received
                          </Button>
                        )}
                        {(ret.status === 'pending' || ret.status === 'received') && (
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-green-700 border-green-300"
                            onClick={() => { updateReturn(ret.id, { status: 'refunded' }); toast.success('Return refunded'); }}>
                            <CheckCircle className="h-3 w-3 mr-1" />Refund
                          </Button>
                        )}
                        {ret.status !== 'rejected' && ret.status !== 'refunded' && (
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-red-600 border-red-200"
                            onClick={() => { updateReturn(ret.id, { status: 'rejected' }); toast.error('Return rejected'); }}>
                            <XCircle className="h-3 w-3 mr-1" />Reject
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
