'use client';

import { useState, useMemo } from 'react';
import { useOrderStore } from '@/lib/store';
import { useSettingNumber } from '@/hooks/use-settings';
import { Order } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  RotateCcw,
  Trash,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { ORDER_STATUS_CONFIG } from '@/lib/types';
import { DeliveryBadge } from '@/components/delivery-badge';
import { toast } from 'sonner';
import { OrderDetailDialog } from '@/components/order-detail-dialog';
import { AppShell } from '@/components/app-shell';

const PAGE_SIZE = 25;

export default function RecentlyDeletedPage() {
  const orders = useOrderStore((s) => s.orders);
  const retentionDays = useSettingNumber('data.recentlyDeletedDays');
  const restoreOrder = useOrderStore((s) => s.restoreOrder);
  const permanentDeleteOrder = useOrderStore((s) => s.permanentDeleteOrder);
  
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [page, setPage] = useState(0);
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [sortField, setSortField] = useState<string>('deletedAt');

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const deletedOrders = useMemo(() => {
    // Only show orders deleted within the retention window (Settings → Data).
    const cutoff = retentionDays > 0 ? Date.now() - retentionDays * 86400000 : 0;
    let result = orders.filter((o) => o.deletedAt && (!cutoff || new Date(o.deletedAt).getTime() >= cutoff));

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (o) =>
          o.itemTitle.toLowerCase().includes(q) ||
          o.postToName.toLowerCase().includes(q) ||
          o.salesRecordNumber.toLowerCase().includes(q) ||
          o.orderNumber.toLowerCase().includes(q) ||
          o.buyerUsername.toLowerCase().includes(q)
      );
    }

    // Sort by deleted date by default
    result.sort((a, b) => {
      let aVal: any, bVal: any;
      
      switch (sortField) {
        case 'deletedAt':
          aVal = new Date(a.deletedAt!).getTime();
          bVal = new Date(b.deletedAt!).getTime();
          break;
        case 'salesRecordNumber':
          aVal = a.salesRecordNumber;
          bVal = b.salesRecordNumber;
          break;
        case 'postToName':
          aVal = a.postToName;
          bVal = b.postToName;
          break;
        case 'itemTitle':
          aVal = a.itemTitle;
          bVal = b.itemTitle;
          break;
        default:
          return 0;
      }
      
      if (sortDir === 'desc') {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      } else {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      }
    });

    return result;
  }, [orders, search, sortField, sortDir, retentionDays]);

  const totalPages = Math.ceil(deletedOrders.length / PAGE_SIZE);
  const pageOrders = deletedOrders.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleRestore = (order: Order) => {
    restoreOrder(order.id);
    toast.success(`Order ${order.salesRecordNumber} restored`);
  };

  const handlePermanentDelete = (order: Order) => {
    if (window.confirm(`Are you sure you want to permanently delete order ${order.salesRecordNumber}? This action cannot be undone.`)) {
      permanentDeleteOrder(order.id);
      toast.success(`Order ${order.salesRecordNumber} permanently deleted`);
    }
  };

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Recently Deleted</h1>
        <p className="text-slate-600">Orders that have been deleted and can be restored or permanently deleted.</p>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search deleted orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 max-w-md"
          />
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead 
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('deletedAt')}
              >
                <div className="flex items-center gap-1">
                  Deleted At
                  {sortField === 'deletedAt' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
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
                className="text-xs cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('itemTitle')}
              >
                <div className="flex items-center gap-1">
                  Item
                  {sortField === 'itemTitle' && (
                    sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                  )}
                </div>
              </TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                  {deletedOrders.length === 0
                    ? 'No deleted orders.'
                    : 'No deleted orders match your search.'}
                </TableCell>
              </TableRow>
            ) : (
              pageOrders.map((order) => (
                <TableRow
                  key={order.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setSelectedOrder(order)}
                >
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {order.deletedAt 
                      ? new Date(order.deletedAt).toLocaleString('en-GB')
                      : '-'
                    }
                  </TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    <div>{order.amazonOrderId || order.salesRecordNumber}</div>
                    {order.buyerUsername && (
                      <div className="text-slate-400 text-[10px]">{order.buyerUsername}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="font-medium">{order.postToName}</div>
                    <DeliveryBadge deliveryType={order.deliveryType} deliveryCarrier={order.deliveryCarrier} />
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">
                    {order.itemTitle}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`${ORDER_STATUS_CONFIG[order.status].color} text-xs`}
                    >
                      {ORDER_STATUS_CONFIG[order.status].label}
                    </Badge>
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
                          onClick={() => handleRestore(order)}
                          className="text-blue-600 focus:text-blue-600"
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Restore Order
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handlePermanentDelete(order)}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Trash className="h-4 w-4 mr-2" />
                          Permanent Delete
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
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-slate-500">
            Showing {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, deletedOrders.length)} of{' '}
            {deletedOrders.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
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
              Next
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
    </AppShell>
  );
}
