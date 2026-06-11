'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOrderStore } from '@/lib/store';
import { ORDER_STATUS_CONFIG, OrderStatus, Order } from '@/lib/types';
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
} from 'lucide-react';
import { generateBatchShipCSV } from '@/lib/csv-parser';
import { toast } from 'sonner';
import { OrderDetailDialog } from './order-detail-dialog';

const PAGE_SIZE = 25;

export function OrderTable() {
  const orders = useOrderStore((s) => s.orders);
  const updateOrderStatus = useOrderStore((s) => s.updateOrderStatus);
  const updateOrderPriority = useOrderStore((s) => s.updateOrderPriority);
  const updateOrderCategory = useOrderStore((s) => s.updateOrderCategory);
  const bulkUpdateStatus = useOrderStore((s) => s.bulkUpdateStatus);

  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || 'all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  useEffect(() => {
    const s = searchParams.get('status');
    if (s) setStatusFilter(s);
  }, [searchParams]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [sortField, setSortField] = useState<string>('saleDate');

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const filtered = useMemo(() => {
    let result = [...orders];
    if (statusFilter !== 'all') {
      result = result.filter((o) => o.status === statusFilter);
    }
    if (categoryFilter !== 'all') {
      result = result.filter((o) => o.category === categoryFilter);
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
          o.category.toLowerCase().includes(q)
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
        default:
          aValue = a.salesRecordNumber;
          bValue = b.salesRecordNumber;
      }
      
      const comparison = aValue.localeCompare(bValue);
      return sortDir === 'desc' ? -comparison : comparison;
    });
    return result;
  }, [orders, statusFilter, categoryFilter, search, sortDir, sortField]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageOrders = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Order Sheet</h2>
        <p className="text-slate-500 text-sm mt-1">
          Manage orders, update statuses, and track progress
        </p>
      </div>

      {/* Filters & bulk actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search orders, items, customers..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>
        <button
          onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          className="flex items-center gap-1.5 px-3 h-10 rounded-md border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50 transition-colors shrink-0"
          title="Toggle date sort"
        >
          {sortDir === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
          Date
        </button>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v ?? 'all');
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {(Object.keys(ORDER_STATUS_CONFIG) as OrderStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {ORDER_STATUS_CONFIG[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={categoryFilter}
          onValueChange={(v) => {
            setCategoryFilter(v ?? 'all');
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
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
          </div>
        )}
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-10">
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
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors"
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
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('saleDate')}
              >
                <div className="flex items-center gap-1">
                  Date
                  {sortField === 'saleDate' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors"
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
                className="text-xs max-w-[250px] cursor-pointer hover:bg-slate-100 transition-colors"
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
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors"
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
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors"
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
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('postByDate')}
              >
                <div className="flex items-center gap-1">
                  Post By Date
                  {sortField === 'postByDate' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors"
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
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center gap-1">
                  Status
                  {sortField === 'status' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('buyerUsername')}
              >
                <div className="flex items-center gap-1">
                  User ID
                  {sortField === 'buyerUsername' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead 
                className="text-xs max-w-[200px] cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('buyerNote')}
              >
                <div className="flex items-center gap-1">
                  Buyer Note
                  {sortField === 'buyerNote' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead className="text-xs w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-8 text-slate-500">
                  {orders.length === 0
                    ? 'No orders imported yet. Go to Import Orders to get started.'
                    : 'No orders match your filters.'}
                </TableCell>
              </TableRow>
            ) : (
              pageOrders.map((order) => (
                <TableRow
                  key={order.id}
                  className={`cursor-pointer hover:bg-slate-50 ${
                    order.priority === 1 ? 'bg-red-50 border-l-4 border-red-500' : ''
                  }`}
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
                  <TableCell className="font-mono text-xs">
                    {order.salesRecordNumber}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {order.saleDate
                      ? new Date(order.saleDate).toLocaleDateString('en-GB')
                      : '-'}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="font-medium">{order.postToName}</div>
                    {order.buyerUsername && (
                      <div className="text-slate-400">{order.buyerUsername}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs max-w-[250px] truncate">
                    {order.itemTitle}
                  </TableCell>
                  <TableCell className="text-xs text-center">
                    {order.quantity}
                  </TableCell>
                  <TableCell className="text-xs text-center">
                    <Select
                      value={order.priority.toString()}
                      onValueChange={(v) => updateOrderPriority(order.id, parseInt(v))}
                    >
                      <SelectTrigger className="h-7 text-xs w-[60px] border-0 p-0">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            order.priority === 1
                              ? 'bg-red-100 text-red-800 border-red-300 font-bold'
                              : order.priority === 2
                              ? 'bg-orange-100 text-orange-800 border-orange-300'
                              : order.priority === 3
                              ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                              : order.priority === 4
                              ? 'bg-blue-100 text-blue-800 border-blue-300'
                              : 'bg-slate-100 text-slate-600 border-slate-300'
                          }`}
                        >
                          {order.priority}
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
                  <TableCell className="text-xs text-slate-600">
                    {order.postByDate
                      ? new Date(order.postByDate).toLocaleDateString('en-GB')
                      : '-'}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()} className="min-w-[120px]">
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
                  </TableCell>
                  <TableCell className="text-xs text-slate-500 font-mono">
                    {order.buyerUsername}
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">
                    {order.buyerNote || '-'}
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
    </div>
  );
}
