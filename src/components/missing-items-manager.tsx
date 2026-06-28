'use client';

import { useState, useMemo } from 'react';
import { useOrderStore } from '@/lib/store';
import { MissingItemRecord, MissingPart, DEPARTMENT_CONFIG, Department } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { PackageMinus, Search, Plus, Trash2, ExternalLink, Truck, CheckCircle2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const STATUS_CONFIG: Record<MissingItemRecord['status'], { label: string; color: string; icon: React.ElementType }> = {
  pending:    { label: 'Pending Dispatch', color: 'bg-amber-100 text-amber-800 border-amber-300',  icon: Clock },
  dispatched: { label: 'Dispatched',       color: 'bg-blue-100 text-blue-800 border-blue-300',    icon: Truck },
  resolved:   { label: 'Resolved',         color: 'bg-green-100 text-green-800 border-green-300', icon: CheckCircle2 },
};

export function MissingItemsManager() {
  const orders      = useOrderStore((s) => s.orders);
  const users       = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const missingItems  = useOrderStore((s) => s.missingItems);
  const addMissingItem      = useOrderStore((s) => s.addMissingItem);
  const updateMissingItem   = useOrderStore((s) => s.updateMissingItem);
  const createMissingItemOrder = useOrderStore((s) => s.createMissingItemOrder);

  const currentUser = users.find((u) => u.id === currentUserId);

  // --- list filters ---
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showForm, setShowForm]       = useState(false);

  // --- new report form ---
  const [orderSearch, setOrderSearch]     = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [parts, setParts]                 = useState<MissingPart[]>([{ description: '', quantity: 1 }]);
  const [notes, setNotes]                 = useState('');
  const [responsibleDept, setResponsibleDept] = useState<Department | ''>('');
  const [responsibleUserId, setResponsibleUserId] = useState('');

  // --- resolve dialog ---
  const [resolveRecord, setResolveRecord] = useState<MissingItemRecord | null>(null);

  const orderSuggestions = useMemo(() => {
    if (!orderSearch.trim()) return [];
    const q = orderSearch.toLowerCase();
    return orders
      .filter((o) => !o.deletedAt && (
        o.salesRecordNumber.toLowerCase().includes(q) ||
        o.postToName.toLowerCase().includes(q) ||
        o.itemTitle.toLowerCase().includes(q) ||
        o.buyerUsername.toLowerCase().includes(q)
      ))
      .slice(0, 6);
  }, [orders, orderSearch]);

  const filteredRecords = useMemo(() => {
    let r = [...missingItems].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
    if (statusFilter !== 'all') r = r.filter((x) => x.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((x) =>
        x.salesRecordNumber.toLowerCase().includes(q) ||
        x.buyerUsername.toLowerCase().includes(q) ||
        x.itemTitle.toLowerCase().includes(q) ||
        x.missingParts.some((p) => p.description.toLowerCase().includes(q))
      );
    }
    return r;
  }, [missingItems, statusFilter, search]);

  const selectedOrder = orders.find((o) => o.id === selectedOrderId);

  function addPart() {
    setParts((prev) => [...prev, { description: '', quantity: 1 }]);
  }

  function removePart(idx: number) {
    setParts((prev) => prev.filter((_, i) => i !== idx));
  }

  function updatePart(idx: number, field: keyof MissingPart, value: string | number) {
    setParts((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }

  function handleSubmit() {
    if (!selectedOrderId) { toast.error('Select an order'); return; }
    const order = orders.find((o) => o.id === selectedOrderId);
    if (!order) return;
    const validParts = parts.filter((p) => p.description.trim());
    if (validParts.length === 0) { toast.error('Add at least one missing part'); return; }

    const record: MissingItemRecord = {
      id: generateId(),
      orderId: selectedOrderId,
      salesRecordNumber: order.salesRecordNumber,
      buyerUsername: order.buyerUsername,
      itemTitle: order.itemTitle,
      missingParts: validParts,
      notes: notes.trim(),
      reportedAt: new Date().toISOString(),
      reportedByUserId: currentUser?.id,
      reportedByUserName: currentUser?.name,
      responsibleDepartment: responsibleDept || undefined,
      responsibleUserId: responsibleUserId || undefined,
      responsibleUserName: responsibleUserId ? users.find((u) => u.id === responsibleUserId)?.name : undefined,
      status: 'pending',
    };

    addMissingItem(record);
    toast.success(`Missing parts reported for #${order.salesRecordNumber}`);
    setShowForm(false);
    setOrderSearch('');
    setSelectedOrderId('');
    setParts([{ description: '', quantity: 1 }]);
    setNotes('');
    setResponsibleDept('');
    setResponsibleUserId('');
  }

  function handleCreateOrder(record: MissingItemRecord) {
    try {
      const order = createMissingItemOrder(record.id);
      toast.success(`Dispatch order ${order.salesRecordNumber} created → now in Queue`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create order');
    }
  }

  function handleMarkResolved(record: MissingItemRecord) {
    updateMissingItem(record.id, { status: 'resolved' });
    toast.success('Marked as resolved');
    setResolveRecord(null);
  }

  const pendingCount = missingItems.filter((m) => m.status === 'pending').length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <PackageMinus className="h-6 w-6 text-orange-500" />
            Missing Items
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Track and dispatch missing accessories or parts forgotten from shipped orders
          </p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Report Missing Parts
        </Button>
      </div>

      {pendingCount > 0 && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <Clock className="h-4 w-4 shrink-0" />
          <span><strong>{pendingCount}</strong> missing parts report{pendingCount !== 1 ? 's' : ''} pending dispatch</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order, buyer, part..."
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="w-[160px] h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filteredRecords.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <PackageMinus className="h-10 w-10 mx-auto mb-2 text-slate-200" />
              <p className="font-medium">No missing items records</p>
              <p className="text-xs mt-1">Use "Report Missing Parts" to log an omission.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Sale #</TableHead>
                  <TableHead className="text-xs">Buyer</TableHead>
                  <TableHead className="text-xs">Original Item</TableHead>
                  <TableHead className="text-xs">Missing Parts</TableHead>
                  <TableHead className="text-xs">Responsible</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Dispatch Order</TableHead>
                  <TableHead className="text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((rec) => {
                  const dispatchOrder = rec.dispatchOrderId ? orders.find((o) => o.id === rec.dispatchOrderId) : null;
                  const StatusIcon = STATUS_CONFIG[rec.status].icon;
                  return (
                    <TableRow key={rec.id}>
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                        {new Date(rec.reportedAt).toLocaleDateString('en-GB')}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{rec.salesRecordNumber}</TableCell>
                      <TableCell className="text-xs text-slate-600">{rec.buyerUsername || '—'}</TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate">{rec.itemTitle}</TableCell>
                      <TableCell className="text-xs max-w-[180px]">
                        <ul className="space-y-0.5">
                          {rec.missingParts.map((p, i) => (
                            <li key={i} className="flex items-center gap-1">
                              <span className="inline-block bg-orange-100 text-orange-700 rounded px-1 text-[10px] font-bold shrink-0">x{p.quantity}</span>
                              <span className="truncate">{p.description}</span>
                            </li>
                          ))}
                        </ul>
                        {rec.notes && <p className="text-slate-400 text-[10px] mt-0.5 truncate">{rec.notes}</p>}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {rec.responsibleDepartment
                          ? DEPARTMENT_CONFIG[rec.responsibleDepartment]?.label ?? rec.responsibleDepartment
                          : '—'}
                        {rec.responsibleUserName && (
                          <div className="text-[10px] text-slate-400">{rec.responsibleUserName}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs flex items-center gap-1 w-fit ${STATUS_CONFIG[rec.status].color}`}>
                          <StatusIcon className="h-2.5 w-2.5" />
                          {STATUS_CONFIG[rec.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {dispatchOrder ? (
                          <Link
                            href={`/orders?search=${dispatchOrder.salesRecordNumber}`}
                            className="inline-flex items-center text-blue-600 hover:underline"
                          >
                            {dispatchOrder.salesRecordNumber}
                            <ExternalLink className="h-3 w-3 ml-1" />
                          </Link>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {rec.status === 'pending' && (
                            <Button
                              size="sm"
                              className="h-6 text-xs px-2 bg-blue-600 hover:bg-blue-700 text-white"
                              onClick={() => handleCreateOrder(rec)}
                            >
                              <Truck className="h-3 w-3 mr-1" />
                              Create Dispatch
                            </Button>
                          )}
                          {rec.status === 'dispatched' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-xs px-2 text-green-700 border-green-300 hover:bg-green-50"
                              onClick={() => setResolveRecord(rec)}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Resolve
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* New report form dialog */}
      {showForm && (
        <Dialog open onOpenChange={(open) => { if (!open) setShowForm(false); }}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PackageMinus className="h-5 w-5 text-orange-500" />
                Report Missing Parts
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Order search */}
              <div>
                <label className="text-xs text-slate-500 block mb-1">Search order</label>
                <Input
                  value={orderSearch}
                  onChange={(e) => { setOrderSearch(e.target.value); setSelectedOrderId(''); }}
                  placeholder="Order #, buyer name, item..."
                  className="h-8 text-sm"
                />
                {orderSuggestions.length > 0 && !selectedOrderId && (
                  <div className="border rounded-lg mt-1 bg-white shadow-sm divide-y">
                    {orderSuggestions.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50"
                        onClick={() => { setSelectedOrderId(o.id); setOrderSearch(o.salesRecordNumber); }}
                      >
                        <span className="font-mono font-bold text-slate-700">#{o.salesRecordNumber}</span>
                        <span className="text-slate-500 ml-2">{o.postToName}</span>
                        <span className="text-slate-400 ml-2 truncate block">{o.itemTitle}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedOrder && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1">
                  <p className="font-semibold text-slate-700">Selected Order</p>
                  <p className="font-medium">{selectedOrder.itemTitle}</p>
                  {selectedOrder.variation && (
                    <p className="text-amber-700">Variation: {selectedOrder.variation}</p>
                  )}
                  <p className="text-slate-500">{selectedOrder.postToName} · {selectedOrder.postToPostcode}</p>
                  <p className="text-slate-500 capitalize">Status: <strong>{selectedOrder.status}</strong></p>
                </div>
              )}

              {/* Missing parts list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-500">Missing parts / accessories</label>
                  <Button size="sm" variant="outline" className="h-6 text-xs" onClick={addPart}>
                    <Plus className="h-3 w-3 mr-1" /> Add Part
                  </Button>
                </div>
                <div className="space-y-2">
                  {parts.map((part, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={part.description}
                        onChange={(e) => updatePart(idx, 'description', e.target.value)}
                        placeholder="e.g. Power cable, HDMI cable, Remote control..."
                        className="h-8 text-sm flex-1"
                      />
                      <input
                        type="number"
                        min={1}
                        value={part.quantity}
                        onChange={(e) => updatePart(idx, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-14 h-8 border rounded px-2 text-sm text-center"
                        title="Quantity"
                      />
                      {parts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePart(idx)}
                          className="text-slate-400 hover:text-red-500 p-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs text-slate-500 block mb-1">Internal notes</label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Found in QC — cable missing from box"
                  className="h-8 text-sm"
                />
              </div>

              {/* Responsible dept */}
              <div className="flex gap-3 flex-wrap">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Responsible department</label>
                  <Select value={responsibleDept} onValueChange={(v) => v && setResponsibleDept(v as Department)}>
                    <SelectTrigger className="h-8 text-sm w-40"><SelectValue placeholder="Select dept" /></SelectTrigger>
                    <SelectContent>
                      {(['assembler', 'packing'] as Department[]).map((k) => (
                        <SelectItem key={k} value={k}>{DEPARTMENT_CONFIG[k].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Responsible staff</label>
                  <Select value={responsibleUserId} onValueChange={(v) => v && setResponsibleUserId(v)}>
                    <SelectTrigger className="h-8 text-sm w-40"><SelectValue placeholder="Select user" /></SelectTrigger>
                    <SelectContent>
                      {users
                        .filter((u) => !responsibleDept || u.departments?.includes(responsibleDept) || u.department === responsibleDept)
                        .map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={handleSubmit} className="bg-orange-600 hover:bg-orange-700 text-white">
                <PackageMinus className="h-4 w-4 mr-2" />
                Log Missing Parts
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Resolve confirmation */}
      {resolveRecord && (
        <Dialog open onOpenChange={(open) => { if (!open) setResolveRecord(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Mark as Resolved</DialogTitle>
            </DialogHeader>
            <div className="py-2 space-y-2 text-sm text-slate-600">
              <p>Confirm that the missing parts for order <strong>#{resolveRecord.salesRecordNumber}</strong> have been sent and received by the customer.</p>
              <div className="bg-slate-50 rounded p-2 text-xs">
                {resolveRecord.missingParts.map((p, i) => (
                  <div key={i}>x{p.quantity} {p.description}</div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResolveRecord(null)}>Cancel</Button>
              <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handleMarkResolved(resolveRecord)}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Mark Resolved
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
