'use client';

import { useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { ORDER_STATUS_CONFIG, PACKAGING_STAGES, OrderStatus, PackagingStage } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  AlertTriangle,
  Wrench,
  ClipboardCheck,
  BoxSelect,
  Package,
  Clock,
  Undo2,
  X,
  User,
  MapPin,
  Tag,
  Hash,
} from 'lucide-react';
import { toast } from 'sonner';

export function PackagingPipeline() {
  const orders = useOrderStore((s) => s.orders);
  const updateOrderStatus = useOrderStore((s) => s.updateOrderStatus);
  const bulkUpdateStatus = useOrderStore((s) => s.bulkUpdateStatus);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const activeOrder = orders.find((o) => o.id === activeOrderId) ?? null;

  const pendingOrders = useMemo(
    () => orders.filter((o) => o.status === 'pending'),
    [orders]
  );
  const assemblingOrders = useMemo(
    () => orders.filter((o) => o.status === 'assembling'),
    [orders]
  );
  const checkingOrders = useMemo(
    () => orders.filter((o) => o.status === 'checking'),
    [orders]
  );
  const packingOrders = useMemo(
    () => orders.filter((o) => o.status === 'packing'),
    [orders]
  );
  const packedOrders = useMemo(
    () => orders.filter((o) => o.status === 'packed'),
    [orders]
  );

  const stageData = [
    { stage: 'pending' as OrderStatus, orders: pendingOrders, icon: Clock, prevStage: null, nextStage: 'assembling' as OrderStatus },
    { stage: 'assembling' as OrderStatus, orders: assemblingOrders, icon: Wrench, prevStage: 'pending' as OrderStatus, nextStage: 'checking' as OrderStatus },
    { stage: 'checking' as OrderStatus, orders: checkingOrders, icon: ClipboardCheck, prevStage: 'assembling' as OrderStatus, nextStage: 'packing' as OrderStatus },
    { stage: 'packing' as OrderStatus, orders: packingOrders, icon: BoxSelect, prevStage: 'checking' as OrderStatus, nextStage: 'packed' as OrderStatus },
    { stage: 'packed' as OrderStatus, orders: packedOrders, icon: Package, prevStage: 'packing' as OrderStatus, nextStage: 'shipped' as OrderStatus },
  ];

  function moveToNext(orderId: string, nextStatus: OrderStatus) {
    updateOrderStatus(orderId, nextStatus);
    toast.success(`Moved to ${ORDER_STATUS_CONFIG[nextStatus].label}`);
  }

  function moveToHeld(orderId: string) {
    updateOrderStatus(orderId, 'held');
    toast.warning('Order placed on hold');
  }

  function moveToPrev(orderId: string, prevStatus: OrderStatus) {
    updateOrderStatus(orderId, prevStatus);
    toast.info(`Moved back to ${ORDER_STATUS_CONFIG[prevStatus].label}`);
  }

  function moveAllToNext(orderIds: string[], nextStatus: OrderStatus) {
    if (orderIds.length === 0) return;
    bulkUpdateStatus(orderIds, nextStatus);
    toast.success(`Moved ${orderIds.length} orders to ${ORDER_STATUS_CONFIG[nextStatus].label}`);
  }

  function moveAllToPrev(orderIds: string[], prevStatus: OrderStatus) {
    if (orderIds.length === 0) return;
    bulkUpdateStatus(orderIds, prevStatus);
    toast.info(`Moved ${orderIds.length} orders back to ${ORDER_STATUS_CONFIG[prevStatus].label}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Queue</h2>
        <p className="text-slate-500 text-sm mt-1">
          Track orders through assembling, checking, and packing stages
        </p>
      </div>

      {/* Pipeline overview */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {stageData.map((s, i) => {
          const config = ORDER_STATUS_CONFIG[s.stage];
          const Icon = s.icon;
          return (
            <div key={s.stage} className="flex items-center gap-2">
              <button
                onClick={() =>
                  document.getElementById(`stage-${s.stage}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
                className={`flex items-center gap-2 px-4 py-3 rounded-lg border cursor-pointer hover:opacity-75 transition-opacity ${config.color} min-w-[140px]`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <div className="text-left">
                  <p className="text-xs font-medium">{config.label}</p>
                  <p className="text-lg font-bold">{s.orders.length}</p>
                </div>
              </button>
              {i < stageData.length - 1 && (
                <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      <Separator />

      {/* Active order banner */}
      {activeOrder ? (
        <div className="relative rounded-xl border-2 border-blue-400 bg-blue-50 px-5 py-4 flex flex-wrap items-start gap-x-6 gap-y-2 shadow-sm">
          <button
            className="absolute top-2 right-2 p-1 rounded hover:bg-blue-100 text-blue-400 hover:text-blue-700"
            onClick={() => setActiveOrderId(null)}
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1.5 text-blue-900">
            <Hash className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono text-sm font-bold">{activeOrder.salesRecordNumber}</span>
            <Badge variant="outline" className={`ml-1 text-xs ${ORDER_STATUS_CONFIG[activeOrder.status].color}`}>
              {ORDER_STATUS_CONFIG[activeOrder.status].label}
            </Badge>
          </div>
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-semibold text-slate-900 leading-snug">{activeOrder.itemTitle}</p>
            {activeOrder.customLabel && (
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                <Tag className="h-3 w-3" />
                SKU: {activeOrder.customLabel}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <User className="h-3.5 w-3.5 shrink-0" />
            <span>{activeOrder.postToName}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span>{activeOrder.postToPostcode}</span>
          </div>
          <div className="text-xs text-slate-600">
            <span className="font-medium">£{activeOrder.totalPrice.toFixed(2)}</span>
            {activeOrder.category && activeOrder.category !== 'N/A' && (
              <Badge variant="outline" className="ml-2 text-xs bg-blue-100 text-blue-800 border-blue-200">
                {activeOrder.category}
              </Badge>
            )}
          </div>
          {activeOrder.labelQty > 1 && (
            <div className="text-xs bg-orange-100 text-orange-800 border border-orange-200 rounded px-2 py-0.5 font-medium">
              {activeOrder.labelQty} labels
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-400 text-center">
          Click any order below to pin it here at a glance
        </div>
      )}

      {/* Stage cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {stageData.map((s) => {
          const config = ORDER_STATUS_CONFIG[s.stage];
          const Icon = s.icon;
          const stageInfo = PACKAGING_STAGES.find((ps) => ps.stage === s.stage);

          return (
            <Card key={s.stage} id={`stage-${s.stage}`} className="flex flex-col scroll-mt-4">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {config.label}
                    <Badge variant="outline" className={`${config.color} ml-1`}>
                      {s.orders.length}
                    </Badge>
                  </CardTitle>
                  {s.orders.length > 0 && (
                    <div className="flex items-center gap-1">
                      {s.prevStage && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 text-slate-500"
                          onClick={() => moveAllToPrev(s.orders.map((o) => o.id), s.prevStage!)}
                        >
                          <ArrowLeft className="h-3 w-3 mr-1" />
                          All Back
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7"
                        onClick={() => moveAllToNext(s.orders.map((o) => o.id), s.nextStage)}
                      >
                        All Next
                        <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  )}
                </div>
                {stageInfo && (
                  <p className="text-xs text-slate-500 mt-1">
                    {stageInfo.description}
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex-1 overflow-auto max-h-[400px]">
                {s.orders.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">
                    No orders in this stage
                  </p>
                ) : (
                  <div className="space-y-2">
                    {s.orders.map((order) => (
                      <div
                        key={order.id}
                        onClick={() => setActiveOrderId(order.id === activeOrderId ? null : order.id)}
                        className={`p-3 border rounded-lg bg-white hover:shadow-sm transition-all cursor-pointer ${
                          order.id === activeOrderId
                            ? 'border-blue-400 ring-2 ring-blue-200 bg-blue-50'
                            : 'hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-mono text-slate-500">
                              #{order.salesRecordNumber}
                            </p>
                            <p className="text-sm font-medium truncate mt-0.5">
                              {order.itemTitle}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {order.postToName} • {order.postToPostcode}
                            </p>
                            {order.customLabel && (
                              <p className="text-xs font-mono text-slate-400 mt-0.5">
                                SKU: {order.customLabel}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              className="h-6 text-xs px-2"
                              onClick={() => moveToNext(order.id, s.nextStage)}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Done
                            </Button>
                            {s.prevStage && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2 text-slate-600"
                                onClick={() => moveToPrev(order.id, s.prevStage!)}
                              >
                                <Undo2 className="h-3 w-3 mr-1" />
                                Back
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => moveToHeld(order.id)}
                            >
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Hold
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* On Hold orders */}
      {orders.filter((o) => o.status === 'held').length > 0 && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" />
              On Hold ({orders.filter((o) => o.status === 'held').length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Order #</TableHead>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs">Customer</TableHead>
                  <TableHead className="text-xs">Comments</TableHead>
                  <TableHead className="text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders
                  .filter((o) => o.status === 'held')
                  .map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-xs">
                        {order.salesRecordNumber}
                      </TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">
                        {order.itemTitle}
                      </TableCell>
                      <TableCell className="text-xs">
                        {order.postToName}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {order.comments || '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs"
                            onClick={() =>
                              updateOrderStatus(order.id, 'pending')
                            }
                          >
                            Release
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs"
                            onClick={() =>
                              updateOrderStatus(order.id, 'cancelled')
                            }
                          >
                            Cancel
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
