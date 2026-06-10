'use client';

import { useMemo } from 'react';
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
} from 'lucide-react';
import { toast } from 'sonner';

export function PackagingPipeline() {
  const orders = useOrderStore((s) => s.orders);
  const updateOrderStatus = useOrderStore((s) => s.updateOrderStatus);
  const bulkUpdateStatus = useOrderStore((s) => s.bulkUpdateStatus);

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

  function moveToDelayed(orderId: string) {
    updateOrderStatus(orderId, 'delayed');
    toast.warning('Order marked as delayed');
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
        <h2 className="text-2xl font-bold text-slate-900">Packaging Pipeline</h2>
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
                        className="p-3 border rounded-lg bg-white hover:shadow-sm transition-shadow"
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
                          <div className="flex flex-col gap-1 shrink-0">
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
                              onClick={() => moveToDelayed(order.id)}
                            >
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Delay
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

      {/* Delayed orders */}
      {orders.filter((o) => o.status === 'delayed').length > 0 && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" />
              Delayed Orders ({orders.filter((o) => o.status === 'delayed').length})
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
                  .filter((o) => o.status === 'delayed')
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
                            Restart
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
