'use client';

import { useState, useMemo } from 'react';
import { useOrderStore } from '@/lib/store';
import { ReturnRecord } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { PackageOpen, Search, Plus, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

const STATUS_CONFIG: Record<ReturnRecord['status'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  received: { label: 'Received', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  refunded: { label: 'Refunded', color: 'bg-green-100 text-green-800 border-green-300' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 border-red-300' },
  replacement: { label: 'Replacement', color: 'bg-purple-100 text-purple-800 border-purple-300' },
  swap: { label: 'Swap — awaiting item', color: 'bg-orange-100 text-orange-800 border-orange-300' },
};

export function ReplacementsManager() {
  const returns = useOrderStore((s) => s.returns);
  const orders = useOrderStore((s) => s.orders);
  const createReplacementOrder = useOrderStore((s) => s.createReplacementOrder);
  const [search, setSearch] = useState('');

  const replacementReturns = useMemo(() => {
    let r = returns.filter((x) => x.status === 'replacement' || x.status === 'swap');
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (x) =>
          x.salesRecordNumber.toLowerCase().includes(q) ||
          x.orderNumber.toLowerCase().includes(q) ||
          x.buyerUsername.toLowerCase().includes(q) ||
          x.itemTitle.toLowerCase().includes(q) ||
          x.replacementItems?.some((i) => i.itemTitle.toLowerCase().includes(q))
      );
    }
    return r.sort((a, b) => b.returnedAt.localeCompare(a.returnedAt));
  }, [returns, search]);

  const getOrderById = (id?: string) => orders.find((o) => o.id === id);

  const handleCreateOrder = (ret: ReturnRecord) => {
    try {
      const order = createReplacementOrder(ret.id);
      toast.success(`Replacement order ${order.salesRecordNumber} created`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create replacement order');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Replacements</h2>
          <p className="text-slate-500 text-sm mt-1">Returns processed as replacements and their shipping orders</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search replacements..."
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {replacementReturns.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <PackageOpen className="h-10 w-10 mx-auto mb-2 text-slate-200" />
              <p>No replacements found</p>
              <p className="text-xs mt-1">Process a return as a replacement from the Returns page.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Sale #</TableHead>
                  <TableHead className="text-xs">eBay User</TableHead>
                  <TableHead className="text-xs">Original Item</TableHead>
                  <TableHead className="text-xs">Replacement Items</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Faulty Return</TableHead>
                  <TableHead className="text-xs">Replacement Order</TableHead>
                  <TableHead className="text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {replacementReturns.map((ret) => {
                  const replacementOrder = getOrderById(ret.replacementOrderId);
                  const originalOrder = getOrderById(ret.orderId);
                  return (
                    <TableRow key={ret.id}>
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                        {new Date(ret.returnedAt).toLocaleDateString('en-GB')}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{ret.salesRecordNumber}</TableCell>
                      <TableCell className="text-xs text-slate-600">{ret.buyerUsername || '—'}</TableCell>
                      <TableCell className="text-xs max-w-[160px] truncate">{ret.itemTitle}</TableCell>
                      <TableCell className="text-xs">
                        {ret.replacementItems && ret.replacementItems.length > 0 ? (
                          <ul className="list-disc list-inside">
                            {ret.replacementItems.map((item, idx) => (
                              <li key={idx}>
                                {item.itemTitle} (x{item.quantity})
                                {item.notes && <span className="text-slate-400 ml-1">— {item.notes}</span>}
                                {item.imageUrls && item.imageUrls.length > 0 && (
                                  <div className="flex -space-x-1 mt-1">
                                    {item.imageUrls.slice(0, 3).map((url, i) => (
                                      <img key={i} src={url} alt="" className="h-6 w-6 rounded-full border border-white object-cover bg-slate-100" />
                                    ))}
                                    {item.imageUrls.length > 3 && (
                                      <span className="h-6 w-6 rounded-full border border-white bg-slate-200 text-[9px] flex items-center justify-center text-slate-600">
                                        +{item.imageUrls.length - 3}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${STATUS_CONFIG[ret.status].color}`}>
                          {STATUS_CONFIG[ret.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {ret.resolution === 'swap' ? (
                          <div>
                            <span className="text-slate-600">
                              {ret.swapReturnMethod === 'collection' ? 'DPD Collection' : ret.swapReturnMethod === 'label' ? 'Return Label' : 'Not booked'}
                            </span>
                            {ret.returnTrackingNumber && (
                              <span className="block font-mono text-slate-400">{ret.returnTrackingNumber}</span>
                            )}
                          </div>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {replacementOrder ? (
                          <Link
                            href={`/orders?search=${replacementOrder.salesRecordNumber}`}
                            className="inline-flex items-center text-blue-600 hover:underline"
                          >
                            {replacementOrder.salesRecordNumber}
                            <ExternalLink className="h-3 w-3 ml-1" />
                          </Link>
                        ) : (
                          'Not created'
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {originalOrder && (
                            <Link href={`/orders?search=${originalOrder.salesRecordNumber}`}>
                              <Button size="sm" variant="outline" className="h-6 text-xs px-2">
                                <ExternalLink className="h-3 w-3 mr-1" />Original
                              </Button>
                            </Link>
                          )}
                          {!replacementOrder && (
                            <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-purple-700 border-purple-300"
                              onClick={() => handleCreateOrder(ret)}>
                              <Plus className="h-3 w-3 mr-1" />Create Order
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
    </div>
  );
}
