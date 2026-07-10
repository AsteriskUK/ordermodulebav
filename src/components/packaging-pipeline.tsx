'use client';

import { useMemo, useState } from 'react';
import { useOrderStore, assemblyLockHolder } from '@/lib/store';
import { ORDER_STATUS_CONFIG, PACKAGING_STAGES, Order, OrderStatus, PackagingStage, DEPARTMENT_CONFIG, Department } from '@/lib/types';
import { getOrderRowClass, buildInvoicesHtml, printHtml } from '@/lib/order-utils';
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
  PackageX,
  Truck,
  MessageSquare,
  Printer,
  ShoppingBag,
  RefreshCw,
  Search,
  Flag,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { DeliveryBadge } from './delivery-badge';
import { OrderSourceLogo, GspDestination } from './order-source-logo';
import { AssemblyBuilder } from './assembly-builder';
import { OrderDetailDialog } from './order-detail-dialog';
import { LabelPrintDialog } from './label-print-dialog';
import { PackScanStation } from './pack-scan-station';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

// Priority badge for queue cards (1 = highest/urgent … 5 = default). Only shown
// for elevated priorities so the default-priority majority stays uncluttered.
const PRIORITY_BADGE: Record<number, { label: string; cls: string }> = {
  1: { label: 'P1 · Urgent', cls: 'bg-red-100 text-red-700 border-red-300' },
  2: { label: 'P2 · High',   cls: 'bg-orange-100 text-orange-700 border-orange-300' },
  3: { label: 'P3 · Medium', cls: 'bg-amber-100 text-amber-700 border-amber-300' },
};

function getAllowedCategories(depts: Department[]): string[] | null {
  const cats: string[] = [];
  let hasOpenDept = false;
  for (const d of depts) {
    const cfg = DEPARTMENT_CONFIG[d];
    if (!cfg) continue;
    if (!cfg.categories) { hasOpenDept = true; break; }
    cats.push(...cfg.categories);
  }
  return hasOpenDept ? null : cats.length ? cats : null;
}

export function PackagingPipeline() {
  const orders = useOrderStore((s) => s.orders);
  const batches = useOrderStore((s) => s.batches);
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const orderSource = (o: Order): string | undefined => {
    const fromBatch = batches.find((b) => b.id === o.batchId)?.source;
    if (fromBatch) return fromBatch;
    // Fall back to the batchId prefix convention (e.g. "ebay-…", "amazon-…")
    const prefix = o.batchId?.split('-')[0];
    return ['ebay', 'amazon', 'backmarket', 'temu', 'onbuy'].includes(prefix) ? prefix : undefined;
  };
  const updateOrderStatus = useOrderStore((s) => s.updateOrderStatus);
  const updateOrderComment = useOrderStore((s) => s.updateOrderComment);
  const bulkUpdateStatus = useOrderStore((s) => s.bulkUpdateStatus);
  const softCancelOrder = useOrderStore((s) => s.softCancelOrder);
  const acquireAssemblyLock = useOrderStore((s) => s.acquireAssemblyLock);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [assemblyOrderId, setAssemblyOrderId] = useState<string | null>(null);
  const activeOrder = orders.find((o) => o.id === activeOrderId) ?? null;
  const [dialogOrderId, setDialogOrderId] = useState<string | null>(null);
  const dialogOrder = dialogOrderId ? orders.find((o) => o.id === dialogOrderId) : null;
  const [showVariationDetails, setShowVariationDetails] = useState(false);
  const [variationOnly, setVariationOnly] = useState(false);
  const [labelOrderId, setLabelOrderId] = useState<string | null>(null);
  const labelOrder = labelOrderId ? orders.find((o) => o.id === labelOrderId) : null;
  const [holdOrderId, setHoldOrderId] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [cancelledAlert, setCancelledAlert] = useState<{ orderId: string; salesRecordNumber: string; itemTitle: string } | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [search, setSearch] = useState('');

  const currentUser = users.find((u) => u.id === currentUserId);
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'manager';
  const userDepts: Department[] = currentUser
    ? (currentUser.departments?.length ? currentUser.departments : [currentUser.department ?? 'management'])
    : [];
  const allowedCategories = isAdmin ? null : getAllowedCategories(userDepts);

  const visibleOrders = useMemo(() => {
    // Exclude orphan ghost rows (no address AND no postcode — from old multi-line-item imports)
    const nonOrphans = orders.filter((o) =>
      (o.postToAddress1 && o.postToAddress1.trim() !== '') ||
      (o.postToPostcode && o.postToPostcode.trim() !== '')
    );
    // Exclude deleted orders
    const activeOrders = nonOrphans.filter((o) => !o.deletedAt);
    let filtered = activeOrders;
    if (!allowedCategories) {
      filtered = activeOrders;
    } else {
      // GSP (international) orders always visible so assemblers can see them
      filtered = activeOrders.filter((o) => o.isGSP || allowedCategories.includes(o.category));
    }
    
    return filtered.sort((a, b) => {
      // Primary sort: priority (lower = higher priority)
      const pA = a.priority ?? 5;
      const pB = b.priority ?? 5;
      if (pA !== pB) return pA - pB;
      // Secondary sort: post-by date
      const dateA = new Date(a.postByDate || a.saleDate).getTime();
      const dateB = new Date(b.postByDate || b.saleDate).getTime();
      return dateA - dateB;
    });
  }, [orders, allowedCategories]);

  // Free-text search across the whole board (available to every user). Matches
  // order numbers, buyer, item, SKU, recipient, postcode and tracking.
  const searchedOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibleOrders;
    return visibleOrders.filter((o) =>
      [
        o.salesRecordNumber, o.orderNumber, o.buyerUsername, o.buyerName,
        o.itemTitle, o.customLabel, o.postToName, o.postToPostcode,
        o.trackingNumber, o.category,
      ].some((f) => (f ?? '').toString().toLowerCase().includes(q))
    );
  }, [visibleOrders, search]);

  const pendingOrders = useMemo(
    () => searchedOrders.filter((o) => o.status === 'pending'),
    [searchedOrders]
  );
  const assemblingOrders = useMemo(
    () => searchedOrders.filter((o) => o.status === 'assembling'),
    [searchedOrders]
  );
  const checkingOrders = useMemo(
    () => searchedOrders.filter((o) => o.status === 'checking'),
    [searchedOrders]
  );
  const packingOrders = useMemo(
    () => searchedOrders.filter((o) => o.status === 'packing'),
    [searchedOrders]
  );
  const packedOrders = useMemo(
    () => searchedOrders.filter((o) => o.status === 'packed'),
    [searchedOrders]
  );
  const shippedOrders = useMemo(
    () => searchedOrders.filter((o) => o.status === 'shipped'),
    [searchedOrders]
  );
  // EOD clearance always acts on every shipped order, never just the search subset.
  const allShippedOrders = useMemo(
    () => visibleOrders.filter((o) => o.status === 'shipped'),
    [visibleOrders]
  );

  const handleEODClear = () => {
    const shippedOrderIds = allShippedOrders.map(o => o.id);
    if (shippedOrderIds.length === 0) {
      toast.info('No shipped orders to clear');
      return;
    }
    
    // Archive shipped orders (remove from active list)
    bulkUpdateStatus(shippedOrderIds, 'archived');
    toast.success(`Cleared ${shippedOrderIds.length} shipped orders (EOD)`);
  };

  const stageData = [
    { stage: 'pending' as OrderStatus, orders: pendingOrders, icon: Clock, prevStage: null, nextStage: 'assembling' as OrderStatus },
    { stage: 'assembling' as OrderStatus, orders: assemblingOrders, icon: Wrench, prevStage: 'pending' as OrderStatus, nextStage: 'checking' as OrderStatus },
    { stage: 'checking' as OrderStatus, orders: checkingOrders, icon: ClipboardCheck, prevStage: 'assembling' as OrderStatus, nextStage: 'packing' as OrderStatus },
    { stage: 'packing' as OrderStatus, orders: packingOrders, icon: BoxSelect, prevStage: 'checking' as OrderStatus, nextStage: 'packed' as OrderStatus },
    { stage: 'packed' as OrderStatus, orders: packedOrders, icon: Package, prevStage: 'packing' as OrderStatus, nextStage: 'shipped' as OrderStatus },
    { stage: 'shipped' as OrderStatus, orders: shippedOrders, icon: Truck, prevStage: 'packed' as OrderStatus, nextStage: 'delivered' as OrderStatus },
  ];

  // Stage visibility by role: assembling teams see up to Checking; packers see
  // Packing → Shipped; admin/manager (and anyone in both) see everything.
  const ASSEMBLE_STAGES: OrderStatus[] = ['pending', 'assembling', 'checking'];
  const PACK_STAGES: OrderStatus[] = ['packing', 'packed', 'shipped'];
  const isPacker = userDepts.includes('packing');
  const isAssembler = userDepts.some((d) => ['assembler', 'qa', 'laptop', 'gaming-pc', 'projector', 'pc-aio-mini', 'monitor', 'networking'].includes(d));
  const allowedStages: OrderStatus[] | null = isAdmin || (isPacker && isAssembler) ? null
    : isPacker ? PACK_STAGES
    : isAssembler ? ASSEMBLE_STAGES
    : null;
  const visibleStages = allowedStages ? stageData.filter((s) => allowedStages.includes(s.stage)) : stageData;

  function moveToNext(orderId: string, nextStatus: OrderStatus) {
    updateOrderStatus(orderId, nextStatus);
    toast.success(`Moved to ${ORDER_STATUS_CONFIG[nextStatus].label}`);
  }

  function confirmHold() {
    if (!holdOrderId) return;
    updateOrderStatus(holdOrderId, 'held');
    if (holdReason.trim()) updateOrderComment(holdOrderId, holdReason.trim());
    toast.warning('Order placed on hold');
    setHoldOrderId(null);
    setHoldReason('');
  }

  function moveToNoStock(orderId: string) {
    updateOrderStatus(orderId, 'no-stock');
    toast.warning('Marked as No Stock');
  }

  function cancelOrder(orderId: string) {
    const o = orders.find((x) => x.id === orderId);
    softCancelOrder(orderId);
    toast.info('Order cancelled — raised to Comms as priority');
    if (o) setCancelledAlert({ orderId, salesRecordNumber: o.salesRecordNumber, itemTitle: o.itemTitle });
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Queue</h2>
          <p className="text-slate-500 text-sm mt-1">
            Track orders through assembling, checking, and packing stages
          </p>
        </div>
        <button
          onClick={() => setLastRefresh(new Date())}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh · {lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </button>
      </div>

      {/* Packing scan station — scan the security barcode to pack + print */}
      {(isAdmin || isPacker) && <PackScanStation />}

      {/* Search — filters every stage; available to all users */}
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order #, buyer, item, SKU, postcode, tracking…"
          className="pl-9 pr-16"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-slate-100"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
      {search.trim() && (
        <p className="-mt-3 text-xs text-slate-500">
          {searchedOrders.length} order{searchedOrders.length !== 1 ? 's' : ''} {searchedOrders.length === 1 ? 'matches' : 'match'} &ldquo;{search.trim()}&rdquo; across all stages
        </p>
      )}

      {/* Dept scope indicator */}
      {currentUser ? (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-slate-500">Viewing as:</span>
          <span className="font-medium text-slate-700">{currentUser.name}</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">Departments:</span>
          {userDepts.length > 0 ? (
            userDepts.map((d) => (
              <Badge key={d} variant="outline" className={`text-xs ${DEPARTMENT_CONFIG[d]?.color ?? ''}`}>
                {DEPARTMENT_CONFIG[d]?.label ?? d}
              </Badge>
            ))
          ) : (
            <Badge variant="outline" className="text-xs bg-slate-100 text-slate-700">None</Badge>
          )}
          <span className="text-slate-400 ml-1">
            ({isAdmin ? 'Admin view' : `showing ${visibleOrders.length} of ${orders.length} orders`})
          </span>
        </div>
      ) : (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          No user signed in — showing all orders. Sign in to filter by department.
        </div>
      )}

      {/* EOD Actions */}
      {allShippedOrders.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <span className="text-sm font-medium text-slate-700">
            {allShippedOrders.length} shipped order{allShippedOrders.length !== 1 ? 's' : ''} ready for EOD clearance
          </span>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleEODClear}
            className="text-red-600 border-red-300 hover:bg-red-50"
          >
            Clear Shipped Orders (EOD)
          </Button>
        </div>
      )}

      {/* Pipeline overview */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {visibleStages.map((s, i) => {
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
              {i < visibleStages.length - 1 && (
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
            <OrderSourceLogo source={orderSource(activeOrder)} className="h-4 w-4" />
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
            <Package className="h-3.5 w-3.5 shrink-0" />
            <button
              onClick={() => setShowVariationDetails(true)}
              className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
            >
              View Variation Details
            </button>
          </div>
          {activeOrder.isGSP && (
            <div className="w-full">
              <GspDestination order={activeOrder} />
            </div>
          )}
          <div className="text-xs text-slate-600">
            <span className="font-medium">Priority: {activeOrder.priority ?? 5}</span>
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
        {visibleStages.map((s) => {
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
                        onClick={() => {
                          // Assembling stage → open the full-screen parts/build picker.
                          // Lock it to this assembler so two people don't build the same order.
                          if (s.stage === 'assembling') {
                            const holder = assemblyLockHolder(order);
                            if (holder && holder.id !== currentUserId && !isAdmin) {
                              toast.warning(`Being assembled by ${holder.name ?? 'another user'}`);
                              return;
                            }
                            if (!acquireAssemblyLock(order.id, isAdmin)) {
                              toast.warning('Someone else just started this build');
                              return;
                            }
                            setAssemblyOrderId(order.id);
                            return;
                          }
                          const newId = order.id === activeOrderId ? null : order.id;
                          setActiveOrderId(newId);
                          if (newId && order.variation) {
                            setVariationOnly(true);
                            setShowVariationDetails(true);
                          }
                        }}
                        className={`p-3 border rounded-lg bg-white hover:shadow-sm transition-all cursor-pointer ${
                          order.id === activeOrderId
                            ? 'border-blue-400 ring-2 ring-blue-200 bg-blue-50'
                            : `${getOrderRowClass(order)} hover:border-slate-300`
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {(() => {
                                const pb = PRIORITY_BADGE[order.priority ?? 5];
                                return pb ? (
                                  <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-0 rounded border ${pb.cls} ${order.priority === 1 ? 'animate-pulse' : ''}`}>
                                    <Flag className="h-2.5 w-2.5" /> {pb.label}
                                  </span>
                                ) : null;
                              })()}
                              {(() => {
                                const holder = s.stage === 'assembling' ? assemblyLockHolder(order) : null;
                                return holder && holder.id !== currentUserId ? (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-0 rounded border bg-slate-200 text-slate-600 border-slate-300" title={`Being assembled by ${holder.name ?? 'another user'}`}>
                                    <Lock className="h-2.5 w-2.5" /> {holder.name ?? 'locked'}
                                  </span>
                                ) : null;
                              })()}
                              <OrderSourceLogo source={orderSource(order)} className="h-4 w-4" />
                              <p className="text-xs font-mono text-slate-500">
                                #{order.salesRecordNumber}
                              </p>
                              {order.batchId && (
                                <span className={`text-[10px] font-semibold px-1 py-0 rounded border ${
                                  order.batchId.startsWith('ebay-') ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                  order.batchId.startsWith('backmarket-') ? 'bg-green-50 text-green-700 border-green-200' :
                                  order.batchId.startsWith('amazon-') ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                  order.batchId.startsWith('temu-') ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                  'bg-slate-50 text-slate-500 border-slate-200'
                                }`}>
                                  {order.batchId.startsWith('ebay-') ? 'eBay' :
                                   order.batchId.startsWith('backmarket-') ? 'BM' :
                                   order.batchId.startsWith('amazon-') ? 'AMZ' :
                                   order.batchId.startsWith('temu-') ? 'Temu' : 'Manual'}
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-medium truncate mt-0.5">
                              {order.itemTitle}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {order.postToName} • User ID: {order.buyerUsername}
                            </p>
                            {order.customLabel && (
                              <p className="text-xs font-mono text-slate-400 mt-0.5">
                                SKU: {order.customLabel}
                              </p>
                            )}
                            {order.variation && (
                              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-1 font-medium">
                                ⚠ Variation: {order.variation}
                              </p>
                            )}
                            {(order.notes?.length ?? 0) > 0 && (
                              <div className="mt-1 flex items-start gap-1">
                                <MessageSquare className="h-3 w-3 text-blue-400 shrink-0 mt-0.5" />
                                <p className="text-xs text-blue-600 line-clamp-2">
                                  <span className="font-medium">{order.notes![order.notes!.length - 1].authorName}:</span>{' '}
                                  {order.notes![order.notes!.length - 1].text}
                                  {order.notes!.length > 1 && (
                                    <span className="text-blue-400 ml-1">(+{order.notes!.length - 1} more)</span>
                                  )}
                                </p>
                              </div>
                            )}
                            <div className="flex items-center gap-1 mt-1">
                              <DeliveryBadge deliveryType={order.deliveryType} deliveryCarrier={order.deliveryCarrier} />
                            </div>
                            {order.isGSP && (
                              <div className="mt-1">
                                <GspDestination order={order} />
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            {/* Packed stage: no action buttons — moves via carrier scan */}
                            {s.stage !== 'packed' && (
                              <>
                                {s.stage === 'packing' ? (
                                  (() => {
                                    const hasTracking = !!order.trackingNumber;
                                    const isCollection = order.deliveryType === 'collection';
                                    const canPrint = hasTracking || isCollection;
                                    return (
                                      <>
                                        <Button
                                          size="sm"
                                          className={`h-6 text-xs px-2 ${canPrint ? 'bg-green-600 hover:bg-green-700' : 'bg-slate-300 cursor-not-allowed'}`}
                                          onClick={() => canPrint && setLabelOrderId(order.id)}
                                          disabled={!canPrint}
                                          title={!canPrint ? 'Tracking number required before printing label' : undefined}
                                        >
                                          <Printer className="h-3 w-3 mr-1" />
                                          {isCollection ? 'Pack' : canPrint ? 'Print Label' : 'No Tracking'}
                                        </Button>
                                        {!canPrint && (
                                          <p className="text-[10px] text-amber-600">Add tracking first</p>
                                        )}
                                      </>
                                    );
                                  })()
                                ) : (
                                  <Button
                                    size="sm"
                                    className="h-6 text-xs px-2"
                                    onClick={() => moveToNext(order.id, s.nextStage)}
                                  >
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Done
                                  </Button>
                                )}
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
                                  variant="outline"
                                  className="h-6 text-xs px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  onClick={() => setDialogOrderId(order.id)}
                                >
                                  <MessageSquare className="h-3 w-3 mr-1" />
                                  Note
                                </Button>
                                {s.stage === 'assembling' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-xs px-2 text-slate-600 hover:bg-slate-50"
                                    onClick={() => printHtml(buildInvoicesHtml([order]))}
                                  >
                                    <Printer className="h-3 w-3 mr-1" />
                                    Invoice
                                  </Button>
                                )}
                                {['pending','assembling','checking','packing'].includes(s.stage) && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 text-xs px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                                      onClick={() => { setHoldOrderId(order.id); setHoldReason(''); }}
                                    >
                                      <AlertTriangle className="h-3 w-3 mr-1" />
                                      Hold
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 text-xs px-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                      onClick={() => moveToNoStock(order.id)}
                                    >
                                      <PackageX className="h-3 w-3 mr-1" />
                                      No Stock
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 text-xs px-2 text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                                      onClick={() => cancelOrder(order.id)}
                                    >
                                      <X className="h-3 w-3 mr-1" />
                                      Cancel
                                    </Button>
                                  </>
                                )}
                              </>
                            )}
                            {/* Packed: note + manual ship */}
                            {s.stage === 'packed' && (
                              <>
                                <Button
                                  size="sm"
                                  className="h-6 text-xs px-2 bg-green-600 hover:bg-green-700 text-white"
                                  onClick={() => moveToNext(order.id, 'shipped')}
                                >
                                  <Truck className="h-3 w-3 mr-1" />
                                  Ship
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  onClick={() => setDialogOrderId(order.id)}
                                >
                                  <MessageSquare className="h-3 w-3 mr-1" />
                                  Note
                                </Button>
                              </>
                            )}
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

      {/* No Stock orders */}
      {visibleOrders.filter((o) => o.status === 'no-stock').length > 0 && (
        <Card className="border-orange-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-orange-700">
              <PackageX className="h-4 w-4" />
              No Stock / Stock Shortage ({visibleOrders.filter((o) => o.status === 'no-stock').length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Order #</TableHead>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs">SKU</TableHead>
                  <TableHead className="text-xs">Customer</TableHead>
                  <TableHead className="text-xs">Comments</TableHead>
                  <TableHead className="text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleOrders
                  .filter((o) => o.status === 'no-stock')
                  .map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-xs">{order.salesRecordNumber}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{order.itemTitle}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-400">{order.customLabel || '—'}</TableCell>
                      <TableCell className="text-xs">{order.postToName}</TableCell>
                      <TableCell className="text-xs text-slate-500">{order.comments || '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs text-green-700 border-green-300 hover:bg-green-50"
                            onClick={() => { updateOrderStatus(order.id, 'pending'); toast.success('Released back to Pending'); }}
                          >
                            <ArrowLeft className="h-3 w-3 mr-1" />
                            Release
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs"
                            onClick={() => { updateOrderStatus(order.id, 'cancelled'); toast.info('Order cancelled'); }}
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

      {/* On Hold orders */}
      {visibleOrders.filter((o) => o.status === 'held').length > 0 && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" />
              On Hold ({visibleOrders.filter((o) => o.status === 'held').length})
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
                {visibleOrders
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

      {/* Variation Details Modal */}
      {showVariationDetails && activeOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            {variationOnly ? (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <h3 className="text-lg font-semibold text-amber-700">Variation Detected</h3>
                </div>
                <p className="text-sm text-slate-600 mb-4">
                  This order has a variation. Please ensure you pick the correct item before proceeding.
                </p>
                <div className="space-y-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div>
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Order #</span>
                    <p className="text-sm font-mono font-bold">{activeOrder.salesRecordNumber}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Variation</span>
                    <p className="text-base font-semibold text-amber-800">{activeOrder.variation}</p>
                  </div>
                  {activeOrder.customLabel && (
                    <div>
                      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">SKU</span>
                      <p className="text-sm font-mono">{activeOrder.customLabel}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Item</span>
                    <p className="text-sm">{activeOrder.itemTitle}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Qty</span>
                    <p className="text-sm font-bold">{activeOrder.quantity}</p>
                  </div>
                </div>
                <div className="flex justify-between items-center mt-6">
                  <button
                    className="text-xs text-slate-400 hover:text-slate-600 underline"
                    onClick={() => setVariationOnly(false)}
                  >
                    Show all details
                  </button>
                  <Button
                    size="sm"
                    onClick={() => { setShowVariationDetails(false); setVariationOnly(false); }}
                  >
                    Got it
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-4">Order Details</h3>
                <div className="space-y-3">
                  <div>
                    <span className="text-sm font-medium text-slate-600">Order Number:</span>
                    <p className="text-sm">{activeOrder.salesRecordNumber}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-slate-600">Item Title:</span>
                    <p className="text-sm">{activeOrder.itemTitle}</p>
                  </div>
                  {activeOrder.variation && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-3">
                      <span className="text-sm font-medium text-amber-700">Variation:</span>
                      <p className="text-sm font-semibold text-amber-800">{activeOrder.variation}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-sm font-medium text-slate-600">SKU/Custom Label:</span>
                    <p className="text-sm">{activeOrder.customLabel || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-slate-600">Quantity:</span>
                    <p className="text-sm">{activeOrder.quantity}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-slate-600">Category:</span>
                    <p className="text-sm">{activeOrder.category || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-slate-600">Post By Date:</span>
                    <p className="text-sm">{activeOrder.postByDate || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-slate-600">Buyer Note:</span>
                    <p className="text-sm">{activeOrder.buyerNote || 'No notes'}</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setShowVariationDetails(false); setVariationOnly(false); }}
                  >
                    Close
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Order Detail Dialog for Notes */}
      {dialogOrder && (
        <OrderDetailDialog order={dialogOrder} onClose={() => setDialogOrderId(null)} />
      )}

      {/* Full-screen assembly builder (tap an order in the Assembling stage) */}
      {assemblyOrderId && (() => {
        const o = orders.find((x) => x.id === assemblyOrderId);
        return o ? <AssemblyBuilder order={o} onClose={() => setAssemblyOrderId(null)} /> : null;
      })()}

      {/* Hold with reason dialog */}
      {holdOrderId && (
        <Dialog open onOpenChange={(open) => { if (!open) setHoldOrderId(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Place on Hold</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-slate-500">
                Order #{orders.find(o => o.id === holdOrderId)?.salesRecordNumber}
              </p>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Reason (optional)</label>
                <Input
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  placeholder="e.g. Waiting for stock confirmation"
                  onKeyDown={(e) => e.key === 'Enter' && confirmHold()}
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setHoldOrderId(null)}>Cancel</Button>
              <Button className="bg-red-600 hover:bg-red-700" onClick={confirmHold}>
                <AlertTriangle className="h-4 w-4 mr-1" />
                Place on Hold
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Label Print Dialog */}
      {labelOrder && (
        <LabelPrintDialog
          order={labelOrder}
          onClose={() => setLabelOrderId(null)}
        />
      )}

      {/* Big-screen cancellation alert */}
      {cancelledAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70">
          <div className="bg-white rounded-2xl shadow-2xl border-4 border-red-500 p-10 max-w-xl w-full mx-4 text-center animate-pulse">
            <div className="text-6xl mb-4">🚫</div>
            <h2 className="text-3xl font-black text-red-600 mb-2">ORDER CANCELLED</h2>
            <p className="text-xl font-bold text-slate-800 mb-1">#{cancelledAlert.salesRecordNumber}</p>
            <p className="text-base text-slate-600 mb-6 truncate">{cancelledAlert.itemTitle}</p>
            <p className="text-sm text-slate-500 mb-6">Stop work on this order immediately. Return any items to stock.</p>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white text-lg px-10 py-3 h-auto"
              onClick={() => setCancelledAlert(null)}
            >
              Acknowledged
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
