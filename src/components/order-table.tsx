'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOrderStore } from '@/lib/store';
import { ORDER_STATUS_CONFIG, OrderStatus, Order } from '@/lib/types';
import { getOrderRowClass, getOrderUrgencyLabel } from '@/lib/order-utils';
import { CATEGORIES } from '@/lib/categoriser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Search,
  MoreHorizontal,
  CheckSquare,
  MinusSquare,
  Square,
  Download,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Trash,
  ShoppingBag,
} from 'lucide-react';
import { generateBatchShipCSV } from '@/lib/csv-parser';
import { DeliveryBadge } from './delivery-badge';
import { ItemThumb } from './item-thumb';
import { toast } from 'sonner';
import { OrderDetailDialog } from './order-detail-dialog';
import { EbayMessageDialog } from './ebay-message-dialog';
import { EbayNewMessageDialog } from './ebay-new-message-dialog';

const PAGE_SIZE = 25;

export function OrderTable() {
  const orders = useOrderStore((s) => s.orders);
  const updateOrderStatus = useOrderStore((s) => s.updateOrderStatus);
  const updateOrderPriority = useOrderStore((s) => s.updateOrderPriority);
  const updateOrderCategory = useOrderStore((s) => s.updateOrderCategory);
  const bulkUpdateStatus = useOrderStore((s) => s.bulkUpdateStatus);
  const deleteOrder = useOrderStore((s) => s.deleteOrder);

  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || 'all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  useEffect(() => {
    const s = searchParams.get('status');
    if (s) setStatusFilter(s);
    const q = searchParams.get('search');
    if (q) setSearch(q);
  }, [searchParams]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [messagingOrder, setMessagingOrder] = useState<Order | null>(null);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [sortField, setSortField] = useState<string>('postByDate');
  const [carrierFilter, setCarrierFilter] = useState<string>('all');
  const [deliveryTypeFilter, setDeliveryTypeFilter] = useState<string>('all');
  const [postByDateFrom, setPostByDateFrom] = useState<string>('');
  const [postByDateTo, setPostByDateTo] = useState<string>('');
  const [numberOfBoxesFilter, setNumberOfBoxesFilter] = useState<string>('all');

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleDeleteOrder = (order: Order) => {
    if (window.confirm(`Are you sure you want to delete order ${order.salesRecordNumber}? It will be moved to Recently Deleted and can be restored.`)) {
      deleteOrder(order.id);
      toast.success(`Order ${order.salesRecordNumber} moved to Recently Deleted`);
    }
  };

  const filtered = useMemo(() => {
    let result = [...orders].filter((o) => !o.deletedAt); // Filter out deleted orders
    if (statusFilter !== 'all') {
      result = result.filter((o) => o.status === statusFilter);
    }
    if (categoryFilter !== 'all') {
      result = result.filter((o) => o.category === categoryFilter);
    }
    if (carrierFilter !== 'all') {
      result = result.filter((o) => o.deliveryCarrier === carrierFilter);
    }
    if (deliveryTypeFilter !== 'all') {
      result = result.filter((o) => o.deliveryType === deliveryTypeFilter);
    }
    if (postByDateFrom || postByDateTo) {
      const from = postByDateFrom ? new Date(postByDateFrom).setHours(0, 0, 0, 0) : null;
      const to = postByDateTo ? new Date(postByDateTo).setHours(23, 59, 59, 999) : null;
      result = result.filter((o) => {
        const t = o.postByDate ? new Date(o.postByDate).getTime() : null;
        if (!t) return false;
        if (from && t < from) return false;
        if (to && t > to) return false;
        return true;
      });
    }
    if (numberOfBoxesFilter !== 'all') {
      const n = parseInt(numberOfBoxesFilter);
      result = result.filter((o) => (o.numberOfBoxes ?? 1) === n);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (o) =>
          o.itemTitle.toLowerCase().includes(q) ||
          o.postToName.toLowerCase().includes(q) ||
          o.salesRecordNumber.toLowerCase().includes(q) ||
          o.orderNumber.toLowerCase().includes(q) ||
          o.buyerUsername.toLowerCase().includes(q) ||
          o.buyerEmail.toLowerCase().includes(q) ||
          o.customLabel.toLowerCase().includes(q) ||
          o.buyerNote.toLowerCase().includes(q) ||
          o.category.toLowerCase().includes(q) ||
          (o.deliveryCarrier && o.deliveryCarrier.toLowerCase().includes(q)) ||
          (o.deliveryType && o.deliveryType.toLowerCase().includes(q)) ||
          (o.postToPostcode && o.postToPostcode.toLowerCase().includes(q)) ||
          ((o.numberOfBoxes ?? 1).toString() === q.trim())
      );
    }
    // Sort by selected field
    result.sort((a, b) => {
      // Priority sorting (lower number = higher priority)
      if (sortField === 'priority') {
        return a.priority - b.priority;
      }
      
      // Date sorting
      if (sortField === 'saleDate') {
        const dir = sortDir === 'desc' ? -1 : 1;
        return dir * (new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime());
      }
      
      // Post by date sorting
      if (sortField === 'postByDate') {
        const aDate = a.postByDate ? new Date(a.postByDate).getTime() : 0;
        const bDate = b.postByDate ? new Date(b.postByDate).getTime() : 0;
        const dir = sortDir === 'desc' ? -1 : 1;
        return dir * (aDate - bDate);
      }
      
      // Numeric sorting
      if (sortField === 'quantity') {
        const dir = sortDir === 'desc' ? -1 : 1;
        return dir * (a.quantity - b.quantity);
      }
      
      // String sorting
      let aValue: string = '';
      let bValue: string = '';
      
      switch (sortField) {
        case 'salesRecordNumber':
          aValue = a.salesRecordNumber;
          bValue = b.salesRecordNumber;
          break;
        case 'postToName':
          aValue = a.postToName;
          bValue = b.postToName;
          break;
        case 'itemTitle':
          aValue = a.itemTitle;
          bValue = b.itemTitle;
          break;
        case 'category':
          aValue = a.category || '';
          bValue = b.category || '';
          break;
        case 'status':
          aValue = a.status;
          bValue = b.status;
          break;
        case 'buyerUsername':
          aValue = a.buyerUsername;
          bValue = b.buyerUsername;
          break;
        case 'buyerNote':
          aValue = a.buyerNote;
          bValue = b.buyerNote;
          break;
        case 'deliveryCarrier':
          aValue = a.deliveryCarrier || '';
          bValue = b.deliveryCarrier || '';
          break;
        case 'deliveryType':
          aValue = a.deliveryType || '';
          bValue = b.deliveryType || '';
          break;
        default:
          aValue = a.salesRecordNumber;
          bValue = b.salesRecordNumber;
      }
      
      const comparison = aValue.localeCompare(bValue);
      return sortDir === 'desc' ? -comparison : comparison;
    });
    return result;
  }, [orders, statusFilter, categoryFilter, carrierFilter, deliveryTypeFilter, postByDateFrom, postByDateTo, numberOfBoxesFilter, search, sortDir, sortField]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageOrders = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const hasActiveFilters = search.trim() !== '' || statusFilter !== 'all' || categoryFilter !== 'all' || carrierFilter !== 'all' || deliveryTypeFilter !== 'all' || postByDateFrom !== '' || postByDateTo !== '' || numberOfBoxesFilter !== 'all';

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setCategoryFilter('all');
    setCarrierFilter('all');
    setDeliveryTypeFilter('all');
    setPostByDateFrom('');
    setPostByDateTo('');
    setNumberOfBoxesFilter('all');
    setPage(0);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === pageOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pageOrders.map((o) => o.id)));
    }
  };

  const handleBulkStatus = (status: OrderStatus) => {
    bulkUpdateStatus(Array.from(selectedIds), status);
    toast.success(`Updated ${selectedIds.size} orders to "${ORDER_STATUS_CONFIG[status].label}"`);
    setSelectedIds(new Set());
  };

  const handleExportShipping = () => {
    const selected = orders.filter((o) => selectedIds.has(o.id));
    if (selected.length === 0) {
      toast.error('Select orders to export');
      return;
    }
    const csv = generateBatchShipCSV(selected);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch_ship_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${selected.length} orders for shipping`);
  };

  return (
    <div className="space-y-4 min-w-max">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Order Sheet</h2>
        <p className="text-slate-500 text-sm mt-1">
          Manage orders, update statuses, and track progress
        </p>
      </div>

      {/* Filters — sticky bar with labels */}
      <div className="sticky top-0 z-20 bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* Search */}
          <div className="flex flex-col gap-1 flex-1 min-w-[200px] max-w-sm">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Search</span>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Orders, items, customers..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="pl-9 h-9"
              />
            </div>
          </div>

          {/* Sort */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Sort By</span>
            <div className="flex items-center gap-1">
              <Select value={sortField} onValueChange={(v) => { setSortField(v ?? 'postByDate'); setPage(0); }}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="postByDate">Post By Date</SelectItem>
                  <SelectItem value="saleDate">Sale Date</SelectItem>
                  <SelectItem value="salesRecordNumber">Order #</SelectItem>
                  <SelectItem value="postToName">Customer</SelectItem>
                  <SelectItem value="itemTitle">Item</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                  <SelectItem value="category">Category</SelectItem>
                  <SelectItem value="priority">Priority</SelectItem>
                  <SelectItem value="deliveryCarrier">Carrier</SelectItem>
                  <SelectItem value="deliveryType">Delivery Type</SelectItem>
                </SelectContent>
              </Select>
              <button
                onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                className="flex items-center justify-center h-9 w-9 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors shrink-0"
                title="Toggle sort direction"
              >
                {sortDir === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Status */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</span>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v ?? 'all'); setPage(0); }}>
              <SelectTrigger className="w-[145px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {(Object.keys(ORDER_STATUS_CONFIG) as OrderStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{ORDER_STATUS_CONFIG[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Category</span>
            <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v ?? 'all'); setPage(0); }}>
              <SelectTrigger className="w-[135px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Carrier */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Carrier</span>
            <Select value={carrierFilter} onValueChange={(v) => { setCarrierFilter(v ?? 'all'); setPage(0); }}>
              <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Carriers</SelectItem>
                <SelectItem value="DPD">DPD</SelectItem>
                <SelectItem value="FedEx">FedEx</SelectItem>
                <SelectItem value="Parcelforce">Parcelforce</SelectItem>
                <SelectItem value="Royal Mail">Royal Mail</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Delivery Type */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Service</span>
            <Select value={deliveryTypeFilter} onValueChange={(v) => { setDeliveryTypeFilter(v ?? 'all'); setPage(0); }}>
              <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="two_day">2-Day (BT)</SelectItem>
                <SelectItem value="next_day">Next Day</SelectItem>
                <SelectItem value="express">Express</SelectItem>
                <SelectItem value="collection">Collection</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Post By Date range */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Post By Date</span>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={postByDateFrom}
                onChange={(e) => { setPostByDateFrom(e.target.value); setPage(0); }}
                className="w-[130px] h-9 text-xs"
              />
              <span className="text-slate-300 text-xs">—</span>
              <Input
                type="date"
                value={postByDateTo}
                onChange={(e) => { setPostByDateTo(e.target.value); setPage(0); }}
                className="w-[130px] h-9 text-xs"
              />
            </div>
          </div>

          {/* Boxes */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Boxes</span>
            <Select value={numberOfBoxesFilter} onValueChange={(v) => { setNumberOfBoxesFilter(v ?? 'all'); setPage(0); }}>
              <SelectTrigger className="w-[100px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any</SelectItem>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={n.toString()}>{n} {n === 1 ? 'box' : 'boxes'}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reset */}
          {hasActiveFilters && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-transparent select-none">Reset</span>
              <Button
                size="sm"
                variant="outline"
                onClick={resetFilters}
                className="h-9 text-slate-500 border-slate-300 hover:bg-slate-50 whitespace-nowrap"
              >
                Reset Filters
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-sm text-slate-600 font-medium">
            {selectedIds.size} selected
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
              Set Status
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {(Object.keys(ORDER_STATUS_CONFIG) as OrderStatus[]).map((s) => (
                <DropdownMenuItem key={s} onClick={() => handleBulkStatus(s)}>
                  {ORDER_STATUS_CONFIG[s].label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" onClick={handleExportShipping}>
            <Download className="h-3 w-3 mr-1" />
            Export Shipping CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowNewMessage(true)} className="border-amber-300 text-amber-700 hover:bg-amber-50">
            <ShoppingBag className="h-3 w-3 mr-1" />
            New eBay Message
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg bg-white w-full">
        <Table>
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-slate-50">
              <TableHead className="w-10 bg-slate-50">
                <button onClick={toggleAll} className="p-1">
                  {selectedIds.size === pageOrders.length && pageOrders.length > 0 ? (
                    <CheckSquare className="h-4 w-4 text-blue-600" />
                  ) : selectedIds.size > 0 ? (
                    <MinusSquare className="h-4 w-4 text-blue-400" />
                  ) : (
                    <Square className="h-4 w-4 text-slate-400" />
                  )}
                </button>
              </TableHead>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors bg-slate-50"
                onClick={() => handleSort('salesRecordNumber')}
              >
                <div className="flex items-center gap-1">
                  Order #
                  {sortField === 'salesRecordNumber' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors bg-slate-50"
                onClick={() => handleSort('postByDate')}
              >
                <div className="flex items-center gap-1">
                  Post By
                  {sortField === 'postByDate' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors bg-slate-50"
                onClick={() => handleSort('postToName')}
              >
                <div className="flex items-center gap-1">
                  Customer
                  {sortField === 'postToName' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors bg-slate-50"
                onClick={() => handleSort('itemTitle')}
              >
                <div className="flex items-center gap-1">
                  Item
                  {sortField === 'itemTitle' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors bg-slate-50"
                onClick={() => handleSort('buyerNote')}
              >
                <div className="flex items-center gap-1">
                  Note
                  {sortField === 'buyerNote' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors bg-slate-50"
                onClick={() => handleSort('quantity')}
              >
                <div className="flex items-center gap-1">
                  Qty
                  {sortField === 'quantity' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors bg-slate-50"
                onClick={() => handleSort('priority')}
              >
                <div className="flex items-center gap-1">
                  Priority
                  {sortField === 'priority' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors bg-slate-50"
                onClick={() => handleSort('category')}
              >
                <div className="flex items-center gap-1">
                  Category
                  {sortField === 'category' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors bg-slate-50"
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center gap-1">
                  Status
                  {sortField === 'status' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead className="text-xs w-10 bg-slate-50"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-slate-500">
                  {orders.length === 0
                    ? 'No orders imported yet. Go to Import Orders to get started.'
                    : 'No orders match your filters.'}
                </TableCell>
              </TableRow>
            ) : (
              pageOrders.map((order) => (
                <TableRow
                  key={order.id}
                  className={`cursor-pointer hover:bg-slate-50 ${getOrderRowClass(order)}`}
                  onClick={() => setSelectedOrder(order)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleSelect(order.id)}
                      className="p-1"
                    >
                      {selectedIds.has(order.id) ? (
                        <CheckSquare className="h-4 w-4 text-blue-600" />
                      ) : (
                        <Square className="h-4 w-4 text-slate-400" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    <div>{order.amazonOrderId || order.salesRecordNumber}</div>
                    {order.buyerUsername && (
                      <div className="text-slate-400 text-[10px]">{order.buyerUsername}</div>
                    )}
                    {order.batchId && (
                      <div className={`text-[10px] font-medium mt-0.5 ${
                        order.batchId.startsWith('ebay-') ? 'text-amber-600' :
                        order.batchId.startsWith('backmarket-') ? 'text-green-600' :
                        order.batchId.startsWith('amazon-') ? 'text-orange-600' :
                        order.batchId.startsWith('temu-') ? 'text-purple-600' :
                        'text-slate-400'
                      }`}>
                        {order.batchId.startsWith('ebay-') ? 'eBay' :
                         order.batchId.startsWith('backmarket-') ? 'BackMarket' :
                         order.batchId.startsWith('amazon-') ? 'Amazon' :
                         order.batchId.startsWith('temu-') ? 'Temu' :
                         'Manual'}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600 whitespace-nowrap">
                    {order.postByDate
                      ? new Date(order.postByDate).toLocaleDateString('en-GB')
                      : '-'}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="font-medium">{order.postToName}</div>
                    <DeliveryBadge deliveryType={order.deliveryType} deliveryCarrier={order.deliveryCarrier} />
                    {order.postToPostcode && order.postToPostcode.trim().toUpperCase().startsWith('BT') && (
                      <div className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded px-1 mt-0.5 w-fit">
                        {order.postToPostcode} (NI)
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs max-w-[240px]">
                    <div className="flex items-center gap-2">
                      <ItemThumb itemNumber={order.itemNumber} />
                      <div className="min-w-0">
                        <div className="truncate">{order.itemTitle}</div>
                        {order.variation && (
                          <div className="text-[10px] text-slate-400 truncate" title={order.variation}>{order.variation}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs max-w-[150px] truncate text-slate-500">
                    {order.buyerNote || '-'}
                  </TableCell>
                  <TableCell className={`text-xs text-center font-medium ${order.quantity > 2 ? 'text-red-600 bg-red-50' : ''}`}>
                    {order.quantity}
                  </TableCell>
                  <TableCell className="text-xs text-center">
                    <Select
                      value={(order.priority ?? 5).toString()}
                      onValueChange={(v) => {
                      if (v) {
                        const newPriority = parseInt(v);
                        updateOrderPriority(order.id, newPriority);
                        if (newPriority === 1) {
                          toast.success(`Order ${order.salesRecordNumber} moved to top of queue (Priority 1)`);
                        }
                      }
                    }}
                    >
                      <SelectTrigger className="h-7 text-xs w-[60px] border-0 p-0">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            (order.priority ?? 5) === 1
                              ? 'bg-red-100 text-red-800 border-red-300 font-bold'
                              : (order.priority ?? 5) === 2
                              ? 'bg-orange-100 text-orange-800 border-orange-300'
                              : (order.priority ?? 5) === 3
                              ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                              : (order.priority ?? 5) === 4
                              ? 'bg-blue-100 text-blue-800 border-blue-300'
                              : 'bg-slate-100 text-slate-600 border-slate-300'
                          }`}
                        >
                          {order.priority ?? 5}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((p) => (
                          <SelectItem key={p} value={p.toString()}>
                            {p} {p === 1 ? '(Highest)' : p === 5 ? '(Lowest)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()} className="min-w-[100px]">
                    <Select
                      value={order.category || 'N/A'}
                      onValueChange={(v) => v ? updateOrderCategory(order.id, v) : undefined}
                    >
                      <SelectTrigger className="h-7 text-xs w-[110px] border-0 p-0">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            !order.category || order.category === 'N/A'
                              ? 'bg-slate-100 text-slate-500 border-slate-300'
                              : 'bg-blue-50 text-blue-800 border-blue-200'
                          }`}
                        >
                          {order.category || 'N/A'}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-col gap-1">
                    <Select
                      value={order.status}
                      onValueChange={(v) =>
                        updateOrderStatus(order.id, v as OrderStatus)
                      }
                    >
                      <SelectTrigger className="h-7 text-xs w-[110px] border-0 p-0">
                        <Badge
                          variant="outline"
                          className={`${ORDER_STATUS_CONFIG[order.status].color} text-xs`}
                        >
                          {ORDER_STATUS_CONFIG[order.status].label}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ORDER_STATUS_CONFIG) as OrderStatus[]).map(
                          (s) => (
                            <SelectItem key={s} value={s}>
                              {ORDER_STATUS_CONFIG[s].label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    {order.labelPrintedAt && (
                      <span
                        className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-300 rounded px-1.5 py-0.5 whitespace-nowrap w-fit"
                        title={`Label printed ${new Date(order.labelPrintedAt).toLocaleString('en-GB')} via ${order.labelCarrier ?? ''}`}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Label printed
                      </span>
                    )}
                    </div>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="p-1 hover:bg-slate-100 rounded">
                        <MoreHorizontal className="h-4 w-4 text-slate-400" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setSelectedOrder(order)}
                        >
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            updateOrderStatus(order.id, 'packed')
                          }
                        >
                          Mark Packed
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            updateOrderStatus(order.id, 'shipped')
                          }
                        >
                          Mark Shipped
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            updateOrderStatus(order.id, 'held')
                          }
                        >
                          Place on Hold
                        </DropdownMenuItem>
                        {order.buyerUsername && (
                          <DropdownMenuItem onClick={() => setMessagingOrder(order)}>
                            <ShoppingBag className="h-4 w-4 mr-2 text-amber-600" />
                            Message Buyer (eBay)
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleDeleteOrder(order)}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Trash className="h-4 w-4 mr-2" />
                          Delete Order
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Showing {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, filtered.length)} of{' '}
            {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-slate-600">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail dialog */}
      {selectedOrder && (
        <OrderDetailDialog
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}

      {/* eBay message dialog (from order row) */}
      {messagingOrder && (
        <EbayMessageDialog
          order={messagingOrder}
          onClose={() => setMessagingOrder(null)}
        />
      )}

      {/* New eBay message (any buyer) */}
      {showNewMessage && (
        <EbayNewMessageDialog onClose={() => setShowNewMessage(false)} />
      )}
    </div>
  );
}
