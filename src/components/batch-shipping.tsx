'use client';

import { useState, useMemo } from 'react';
import { useOrderStore } from '@/lib/store';
import { ORDER_STATUS_CONFIG, DeliveryCarrier, DeliveryType, DPDService } from '@/lib/types';
import { generateBatchShipCSV, generateBundledShipCSV, generateCarrierCSV, generateCarrierBundleCSV, groupOrdersByBuyer, BundleGroup, deriveShipping } from '@/lib/csv-parser';
import { getOrderRowClass } from '@/lib/order-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Download, Truck, CheckSquare, MinusSquare, Square, PackageOpen, ChevronDown, ChevronRight, Layers, Sparkles, AlertTriangle, X, Loader2, CheckCircle2, Check, Lock as LockIcon } from 'lucide-react';
import { DeliveryBadge } from './delivery-badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

const CARRIER_PILL: Record<string, string> = {
  DPD:        'bg-purple-100 text-purple-700 border-purple-300',
  FedEx:      'bg-orange-100 text-orange-700 border-orange-300',
  Parcelforce:'bg-red-100 text-red-700 border-red-300',
  'Royal Mail':'bg-blue-100 text-blue-700 border-blue-300',
  Other:      'bg-slate-100 text-slate-600 border-slate-300',
};

function TrackingCell({
  orderId,
  trackingNumber,
  labelCarrier,
  deliveryCarrier,
  updateOrderTracking,
}: {
  orderId: string;
  trackingNumber: string;
  labelCarrier?: string;
  deliveryCarrier?: string;
  updateOrderTracking: (id: string, tracking: string) => void;
}) {
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const currentUser = users.find((u) => u.id === currentUserId);

  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'comms';

  const [value, setValue] = useState(trackingNumber);
  // 'locked' | 'pin' | 'editing'
  const [mode, setMode] = useState<'locked' | 'pin' | 'editing'>('locked');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const pinRef = useState<ReturnType<typeof setTimeout> | null>(null);

  const carrier = labelCarrier || deliveryCarrier || '';
  const pillClass = CARRIER_PILL[carrier] ?? CARRIER_PILL['Other'];

  const handleUnlockClick = () => {
    if (!canEdit) {
      toast.error('Only admins, managers or comms can edit tracking numbers');
      return;
    }
    setPin('');
    setPinError(false);
    setMode('pin');
  };

  const handlePinKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setMode('locked'); setPin(''); return; }
    if (e.key === 'Enter') verifyPin();
  };

  const verifyPin = () => {
    if (!currentUser?.pin) {
      // No PIN set — allow straight through
      setMode('editing');
      return;
    }
    if (pin === currentUser.pin) {
      setPinError(false);
      setMode('editing');
      setPin('');
    } else {
      setPinError(true);
      setPin('');
      // Clear error after 1.5s
      if (pinRef[0]) clearTimeout(pinRef[0]);
      pinRef[0] = setTimeout(() => setPinError(false), 1500);
    }
  };

  const commit = () => {
    if (value.trim() !== trackingNumber) {
      updateOrderTracking(orderId, value.trim());
      if (value.trim()) toast.success(`Tracking saved: ${value.trim()}`);
    }
    setMode('locked');
  };

  const cancel = () => {
    setValue(trackingNumber);
    setMode('locked');
  };

  const CarrierPill = carrier ? (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border w-fit ${pillClass}`}>
      {carrier}
    </span>
  ) : null;

  // ── PIN entry ─────────────────────────────────────────────────────
  if (mode === 'pin') {
    return (
      <div className="flex flex-col gap-1">
        {CarrierPill}
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => { setPin(e.target.value); setPinError(false); }}
            onKeyDown={handlePinKey}
            placeholder="PIN"
            className={`h-7 text-xs font-mono w-[72px] text-center tracking-widest ${pinError ? 'border-red-400 bg-red-50' : ''}`}
          />
          <button onClick={verifyPin} className="p-1 text-blue-600 hover:text-blue-800" title="Confirm PIN">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => { setMode('locked'); setPin(''); }} className="p-1 text-slate-400 hover:text-slate-600" title="Cancel">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {pinError && <span className="text-[10px] text-red-500">Incorrect PIN</span>}
      </div>
    );
  }

  // ── Edit mode (unlocked) ─────────────────────────────────────────
  if (mode === 'editing') {
    return (
      <div className="flex flex-col gap-1">
        {CarrierPill}
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
            className="h-7 text-xs font-mono w-[140px]"
            placeholder="Enter tracking #"
          />
          <button onClick={commit} className="p-1 text-green-600 hover:text-green-800" title="Save">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={cancel} className="p-1 text-slate-400 hover:text-slate-600" title="Cancel">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // ── Read-only (locked) ───────────────────────────────────────────
  return (
    <div className="flex flex-col gap-0.5">
      {CarrierPill}
      <div className="flex items-center gap-1">
        <span
          className={`text-xs font-mono px-1.5 py-0.5 rounded border max-w-[130px] truncate block ${
            value
              ? 'border-green-300 bg-green-50 text-green-800'
              : 'border-dashed border-slate-200 text-slate-400'
          }`}
          title={value || 'No tracking number'}
        >
          {value || '—'}
        </span>
        {canEdit && (
          <button
            onClick={handleUnlockClick}
            className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
            title="Edit tracking (PIN required)"
          >
            <LockIcon className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export function BatchShipping() {
  const orders = useOrderStore((s) => s.orders);
  const bulkUpdateStatus = useOrderStore((s) => s.bulkUpdateStatus);
  const updateOrderCarrier = useOrderStore((s) => s.updateOrderCarrier);
  const updateOrderNumberOfBoxes = useOrderStore((s) => s.updateOrderNumberOfBoxes);
  const updateOrderTracking = useOrderStore((s) => s.updateOrderTracking);
  const updateOrderDeliveryService = useOrderStore((s) => s.updateOrderDeliveryService);
  const updateOrderExtendedLiability = useOrderStore((s) => s.updateOrderExtendedLiability);
  const purgeOrphanOrders = useOrderStore((s) => s.purgeOrphanOrders);
  const saveOrderLabels = useOrderStore((s) => s.saveOrderLabels);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bookingLabels, setBookingLabels] = useState(false);
  const [bundleMode, setBundleMode] = useState(false);
  const [expandedBuyers, setExpandedBuyers] = useState<Set<string>>(new Set());
  const [selectedBuyerKeys, setSelectedBuyerKeys] = useState<Set<string>>(new Set());
  const [selectedCarrier, setSelectedCarrier] = useState<string>('standard');
  const [sortField, setSortField] = useState<'postByDate' | 'saleDate' | 'salesRecordNumber' | 'postToName' | 'itemTitle'>('postByDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filterCarrier, setFilterCarrier] = useState<'all' | 'DPD' | 'FedEx' | 'express' | 'collection' | 'multi-buyer'>('all');
  const [selectedDPDService, setSelectedDPDService] = useState<DPDService>('next_day');
  const [aiChecking, setAiChecking] = useState(false);
  const [aiIssues, setAiIssues] = useState<{ id: string; issue: string }[] | null>(null);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortOrders = (ordersToSort: typeof shippableOrders) => {
    const sorted = [...ordersToSort];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'postByDate': {
          const aDate = new Date(a.postByDate || a.saleDate).getTime();
          const bDate = new Date(b.postByDate || b.saleDate).getTime();
          comparison = aDate - bDate;
          break;
        }
        case 'saleDate': {
          const aDate = new Date(a.saleDate).getTime();
          const bDate = new Date(b.saleDate).getTime();
          comparison = aDate - bDate;
          break;
        }
        case 'salesRecordNumber':
          comparison = a.salesRecordNumber.localeCompare(b.salesRecordNumber);
          break;
        case 'postToName':
          comparison = a.postToName.localeCompare(b.postToName);
          break;
        case 'itemTitle':
          comparison = a.itemTitle.localeCompare(b.itemTitle);
          break;
      }
      return sortDir === 'asc' ? comparison : -comparison;
    });
    return sorted;
  };

  const handleAiCheck = async () => {
    const toCheck = exportableOrders.filter((o) =>
      selectedIds.size > 0 ? selectedIds.has(o.id) : true
    );
    if (toCheck.length === 0) { toast.error('No orders to check'); return; }
    setAiChecking(true);
    setAiIssues(null);
    try {
      const res = await fetch('/api/ai/check-shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orders: toCheck.map((o) => ({
            id: o.id,
            salesRecordNumber: o.salesRecordNumber,
            itemTitle: o.itemTitle,
            postToName: o.postToName,
            postToAddress1: o.postToAddress1,
            postToCity: o.postToCity,
            postToPostcode: o.postToPostcode,
            postToCountry: o.postToCountry,
            totalPrice: o.totalPrice,
            deliveryCarrier: o.deliveryCarrier,
          })),
        }),
      });
      const data = await res.json();
      const issues = Array.isArray(data.issues) ? data.issues : [];
      setAiIssues(issues);
      if (issues.length === 0) toast.success('AI check passed — no issues found ✓');
    } catch {
      toast.error('AI check failed');
    } finally {
      setAiChecking(false);
    }
  };

  // Show orders that are pending or packed (ready for shipping)
  const shippableOrders = useMemo(
    () => orders.filter((o) => o.status === 'pending' || o.status === 'packed'),
    [orders]
  );

  // Group shippable orders by salesRecordNumber for the shipping table (one label per group)
  // Includes collection orders so they can be changed back to a delivery service
  const shipmentGroups = useMemo(() => {
    const sorted = sortOrders([...shippableOrders]);

    const map = new Map<string, typeof sorted>();
    for (const o of sorted) {
      const key = o.salesRecordNumber || o.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }

    return Array.from(map.values()).map((group) => {
      const primary = group.find((o) => o.postToAddress1?.trim() || o.postToPostcode?.trim()) ?? group[0];
      const totalPrice = primary.totalPrice;
      // Use the stored carrier/type from the order — fall back to derived only if not set
      const derived = deriveShipping(primary.postToPostcode, totalPrice, primary.postageAndPackaging ?? 0);
      const deliveryCarrier = primary.deliveryCarrier || derived.deliveryCarrier;
      const deliveryType = primary.deliveryType || derived.deliveryType;
      const combinedTitle = group.map((o) => o.quantity > 1 ? `${o.itemTitle} x${o.quantity}` : o.itemTitle).join(' + ');
      return {
        ids: group.map((o) => o.id),
        primary,
        combinedTitle,
        totalPrice,
        totalQuantity: group.reduce((s, o) => s + o.quantity, 0),
        deliveryCarrier,
        deliveryType,
        isMultiItem: group.length > 1,
      };
    });
  }, [shippableOrders, sortField, sortDir]);

  // Collection orders (no labels, exclude from exports)
  const collectionOrders = useMemo(
    () => orders.filter((o) => o.deliveryType === 'collection' && (o.status === 'pending' || o.status === 'packed')),
    [orders]
  );

  // Orders available for export (exclude collection orders)
  const exportableOrders = useMemo(
    () => sortOrders(shippableOrders.filter((o) => o.deliveryType !== 'collection')),
    [shippableOrders, sortField, sortDir]
  );

  const dpdOrders = useMemo(() => exportableOrders.filter((o) => o.deliveryCarrier === 'DPD'), [exportableOrders]);
  const fedexOrders = useMemo(() => exportableOrders.filter((o) => o.deliveryCarrier === 'FedEx'), [exportableOrders]);
  const expressOrders = useMemo(() => exportableOrders.filter((o) => o.deliveryType === 'express'), [exportableOrders]);

  const bundleGroups = useMemo(
    () => groupOrdersByBuyer(exportableOrders),
    [exportableOrders]
  );

  const multiOrderBuyers = useMemo(
    () => bundleGroups.filter((g) => g.orders.length > 1),
    [bundleGroups]
  );

  const multiOrderBuyerKeys = useMemo(
    () => new Set(multiOrderBuyers.map((g) => g.buyerUsername)),
    [multiOrderBuyers]
  );

  const filteredShipmentGroups = useMemo(() => {
    if (filterCarrier === 'all') return shipmentGroups;
    if (filterCarrier === 'collection') return shipmentGroups.filter((g) => g.primary.deliveryType === 'collection');
    if (filterCarrier === 'express') return shipmentGroups.filter((g) => g.primary.deliveryType === 'express');
    if (filterCarrier === 'multi-buyer') return shipmentGroups.filter((g) => multiOrderBuyerKeys.has(g.primary.buyerUsername || g.primary.postToName));
    return shipmentGroups.filter((g) => g.primary.deliveryCarrier === filterCarrier);
  }, [shipmentGroups, filterCarrier, multiOrderBuyerKeys]);

  const filteredBundleGroups = useMemo(() => {
    if (filterCarrier === 'all') return bundleGroups;
    if (filterCarrier === 'collection') return bundleGroups.filter((g) => g.orders.every((o) => o.deliveryType === 'collection'));
    if (filterCarrier === 'express') return bundleGroups.filter((g) => g.orders.some((o) => o.deliveryType === 'express'));
    if (filterCarrier === 'multi-buyer') return bundleGroups.filter((g) => g.orders.length > 1);
    return bundleGroups.filter((g) => g.orders.some((o) => o.deliveryCarrier === filterCarrier));
  }, [bundleGroups, filterCarrier]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    const allIds = filteredShipmentGroups.flatMap((g) => g.ids);
    if (selectedIds.size === allIds.length && allIds.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const toggleBuyerExpand = (key: string) => {
    const next = new Set(expandedBuyers);
    if (next.has(key)) next.delete(key); else next.add(key);
    setExpandedBuyers(next);
  };

  const toggleBuyerSelect = (key: string) => {
    const next = new Set(selectedBuyerKeys);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelectedBuyerKeys(next);
  };

  const toggleAllBuyers = () => {
    if (selectedBuyerKeys.size === filteredBundleGroups.length && filteredBundleGroups.length > 0) {
      setSelectedBuyerKeys(new Set());
    } else {
      setSelectedBuyerKeys(new Set(filteredBundleGroups.map((g) => g.buyerUsername)));
    }
  };

  const handleExport = () => {
    const selected = exportableOrders.filter((o) => selectedIds.has(o.id));
    if (selected.length === 0) {
      toast.error('Select orders to export for shipping');
      return;
    }
    const csv = generateCarrierCSV(selected, selectedCarrier);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedCarrier}_batch_ship_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${selected.length} orders as ${selectedCarrier} CSV`);
  };

  const handleExportBundles = () => {
    const selectedGroups = bundleGroups.filter((g) => selectedBuyerKeys.has(g.buyerUsername));
    if (selectedGroups.length === 0) {
      toast.error('Select buyers to export bundled labels');
      return;
    }
    const csv = generateCarrierBundleCSV(selectedGroups, selectedCarrier);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedCarrier}_bundled_ship_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    const totalOrders = selectedGroups.reduce((s, g) => s + g.orders.length, 0);
    toast.success(`Exported ${selectedGroups.length} bundled labels (${totalOrders} orders) as ${selectedCarrier} CSV`);
  };

  const handleBookLabels = async (ordersToBook: typeof exportableOrders) => {
    if (ordersToBook.length === 0) return;
    setBookingLabels(true);
    const dpdBatch = ordersToBook.filter((o) => o.deliveryCarrier === 'DPD');
    const fedexBatch = ordersToBook.filter((o) => o.deliveryCarrier === 'FedEx');
    const shipDate = new Date().toISOString().slice(0, 10);
    type ShipResult = { orderId: string; salesRecordNumber: string; trackingNumber?: string; parcelNumber?: string; consignmentNumber?: string; labelBase64?: string; allLabels?: string[]; labelPdfs?: string[]; labelHtmls?: string[] };
    type ShipFailure = { orderId: string; error: string };
    let succeeded: ShipResult[] = [];
    let failed: ShipFailure[] = [];
    try {
      if (dpdBatch.length > 0) {
        const res = await fetch('/api/dpd/create-shipment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orders: dpdBatch, collectionDate: shipDate, service: selectedDPDService }),
        });
        if (res.status === 503) {
          toast.error('DPD API not configured. Fill in DPD credentials in .env.local.');
        } else {
          const data = await res.json() as { succeeded: ShipResult[]; failed: ShipFailure[] };
          succeeded = [...succeeded, ...data.succeeded];
          failed = [...failed, ...data.failed];
        }
      }
      if (fedexBatch.length > 0) {
        const res = await fetch('/api/fedex/create-shipment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orders: fedexBatch, shipDate }),
        });
        if (res.status === 503) {
          toast.error('FedEx API not configured. Fill in FedEx credentials in .env.local.');
        } else {
          const data = await res.json() as { succeeded: ShipResult[]; failed: ShipFailure[] };
          succeeded = [...succeeded, ...data.succeeded];
          failed = [...failed, ...data.failed];
        }
      }
      let totalLabels = 0;
      for (const s of succeeded) {
        console.log('[Book Labels] processing result:', s.orderId, 'tracking=', s.trackingNumber, 'labelPdfs=', s.labelPdfs?.length, 'allLabels=', s.allLabels?.length, 'labelBase64=', !!s.labelBase64, 'labelHtmls=', s.labelHtmls?.length);
        const tracking = s.trackingNumber || s.parcelNumber || s.consignmentNumber || '';
        if (tracking) updateOrderTracking(s.orderId, tracking);
        const carrier = ordersToBook.find((o) => o.id === s.orderId)?.deliveryCarrier ?? 'DPD';
        const storageLabels = s.labelHtmls?.length ? s.labelHtmls
          : s.labelPdfs?.length ? s.labelPdfs
          : s.allLabels?.length ? s.allLabels
          : s.labelBase64 ? [s.labelBase64] : [];
        console.log('[Book Labels] storageLabels count:', storageLabels.length, 'carrier:', carrier);
        if (storageLabels.length > 0) {
          saveOrderLabels(s.orderId, carrier, storageLabels);
          totalLabels += storageLabels.length;
        }
      }
      if (succeeded.length > 0) toast.success(`${succeeded.length} shipment${succeeded.length !== 1 ? 's' : ''} booked — ${totalLabels} label${totalLabels !== 1 ? 's' : ''} saved for printing at packing`);
      if (failed.length > 0) {
        failed.forEach((f) => {
          console.error('[Book Labels] failure:', JSON.stringify(f));
          const errMsg = typeof f.error === 'string' ? f.error : JSON.stringify(f.error);
          toast.error(`Order ${f.orderId || 'unknown'}: ${errMsg}`, { duration: 8000 });
        });
      }
    } catch (e) {
      toast.error(`Booking failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setBookingLabels(false);
    }
  };

  const handleMarkShipped = () => {
    if (selectedIds.size === 0) {
      toast.error('Select orders first');
      return;
    }
    bulkUpdateStatus(Array.from(selectedIds), 'shipped');
    toast.success(`Marked ${selectedIds.size} orders as shipped`);
    setSelectedIds(new Set());
  };

  const handleMarkBundlesShipped = () => {
    if (selectedBuyerKeys.size === 0) {
      toast.error('Select buyers first');
      return;
    }
    const ids = bundleGroups
      .filter((g) => selectedBuyerKeys.has(g.buyerUsername))
      .flatMap((g) => g.orders.map((o) => o.id));
    bulkUpdateStatus(ids, 'shipped');
    toast.success(`Marked ${ids.length} orders as shipped`);
    setSelectedBuyerKeys(new Set());
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Batch Shipping</h2>
          <p className="text-slate-500 text-sm mt-1">
            Generate DPD / FedEx shipping CSVs. Collection orders are excluded from exports.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="border-purple-300 text-purple-700 hover:bg-purple-50"
            onClick={handleAiCheck}
            disabled={aiChecking || exportableOrders.length === 0}
          >
            {aiChecking ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
            {aiChecking ? 'Checking…' : 'AI Check'}
          </Button>
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 shrink-0">
          <button
            onClick={() => setBundleMode(false)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              !bundleMode ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Square className="h-3.5 w-3.5" />
            Individual
          </button>
          <button
            onClick={() => setBundleMode(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              bundleMode ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Bundle
            {multiOrderBuyers.length > 0 && (
              <span className="ml-1 bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {multiOrderBuyers.length}
              </span>
            )}
          </button>
        </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${filterCarrier === 'DPD' ? 'ring-2 ring-purple-400 bg-purple-50' : ''}`}
          onClick={() => setFilterCarrier((f) => (f === 'DPD' ? 'all' : 'DPD'))}
        >
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-purple-600">{dpdOrders.length}</div>
            <p className="text-sm text-slate-500">DPD</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${filterCarrier === 'FedEx' ? 'ring-2 ring-orange-400 bg-orange-50' : ''}`}
          onClick={() => setFilterCarrier((f) => (f === 'FedEx' ? 'all' : 'FedEx'))}
        >
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-orange-500">{fedexOrders.length}</div>
            <p className="text-sm text-slate-500">FedEx</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${filterCarrier === 'express' ? 'ring-2 ring-red-400 bg-red-50' : ''}`}
          onClick={() => setFilterCarrier((f) => (f === 'express' ? 'all' : 'express'))}
        >
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-600">{expressOrders.length}</div>
            <p className="text-sm text-slate-500">Express</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${filterCarrier === 'collection' ? 'ring-2 ring-slate-400 bg-slate-50' : ''}`}
          onClick={() => setFilterCarrier((f) => (f === 'collection' ? 'all' : 'collection'))}
        >
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-slate-400">{collectionOrders.length}</div>
            <p className="text-sm text-slate-500">Collection (no label)</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${filterCarrier === 'multi-buyer' ? 'ring-2 ring-amber-400 bg-amber-50' : ''}`}
          onClick={() => setFilterCarrier((f) => (f === 'multi-buyer' ? 'all' : 'multi-buyer'))}
        >
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-600">{multiOrderBuyers.length}</div>
            <p className="text-sm text-slate-500">Multi-order buyers</p>
          </CardContent>
        </Card>
      </div>

      {filterCarrier !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">Filtered by:</span>
          <Badge variant="outline" className="capitalize">
            {filterCarrier === 'multi-buyer' ? 'Multi-order buyers' : filterCarrier}
          </Badge>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFilterCarrier('all')}>
            Clear
          </Button>
        </div>
      )}

      {/* AI anomaly warnings */}
      {aiIssues && aiIssues.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
              <AlertTriangle className="h-4 w-4" />
              AI found {aiIssues.length} potential issue{aiIssues.length !== 1 ? 's' : ''} — review before booking
            </div>
            <button onClick={() => setAiIssues(null)} className="text-amber-500 hover:text-amber-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          {aiIssues.map((issue) => {
            const order = exportableOrders.find((o) => o.id === issue.id);
            return (
              <div key={issue.id} className="flex items-start gap-2 text-sm text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span><span className="font-mono font-medium">#{order?.salesRecordNumber ?? issue.id}</span> — {issue.issue}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick export/book all by carrier */}
      {!bundleMode && exportableOrders.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {dpdOrders.length > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="text-purple-700 border-purple-300 hover:bg-purple-50"
                onClick={() => {
                  const csv = generateCarrierCSV(dpdOrders, 'dpd');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `dpd_all_${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success(`Exported ${dpdOrders.length} DPD orders`);
                }}
              >
                <Download className="h-3 w-3 mr-1" />
                Export All DPD ({dpdOrders.length})
              </Button>
              <Button
                size="sm"
                className="bg-purple-600 hover:bg-purple-700 text-white"
                disabled={bookingLabels}
                onClick={() => handleBookLabels(dpdOrders)}
              >
                <Truck className="h-3 w-3 mr-1" />
                {bookingLabels ? 'Booking...' : `Book Labels DPD (${dpdOrders.length})`}
              </Button>
            </>
          )}
          {fedexOrders.length > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="text-orange-700 border-orange-300 hover:bg-orange-50"
                onClick={() => {
                  const csv = generateCarrierCSV(fedexOrders, 'fedex');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `fedex_all_${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success(`Exported ${fedexOrders.length} FedEx orders`);
                }}
              >
                <Download className="h-3 w-3 mr-1" />
                Export All FedEx ({fedexOrders.length})
              </Button>
              <Button
                size="sm"
                className="bg-orange-500 hover:bg-orange-600 text-white"
                disabled={bookingLabels}
                onClick={() => handleBookLabels(fedexOrders)}
              >
                <Truck className="h-3 w-3 mr-1" />
                {bookingLabels ? 'Booking...' : `Book Labels FedEx (${fedexOrders.length})`}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Actions bar */}
      {!bundleMode && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm font-medium text-blue-700">{selectedIds.size} orders selected</span>
          <Select value={selectedCarrier} onValueChange={(value) => value && setSelectedCarrier(value)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Select carrier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="dpd">DPD</SelectItem>
              <SelectItem value="fedex">FedEx</SelectItem>
            </SelectContent>
          </Select>
          {selectedCarrier === 'dpd' && (
            <Select value={selectedDPDService} onValueChange={(value) => value && setSelectedDPDService(value as DPDService)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="next_day">NEXT DAY</SelectItem>
                <SelectItem value="by_1030">BY 10:30</SelectItem>
                <SelectItem value="saturday_by_1030">SATURDAY BY 10:30</SelectItem>
                <SelectItem value="by_12">BY 12</SelectItem>
                <SelectItem value="sunday_by_12">SUNDAY BY 12</SelectItem>
                <SelectItem value="saturday_by_12">SATURDAY BY 12</SelectItem>
                <SelectItem value="saturday">SATURDAY</SelectItem>
                <SelectItem value="sunday">SUNDAY</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button size="sm" onClick={handleExport}>
            <Download className="h-3 w-3 mr-1" />
            Download {selectedCarrier === 'standard' ? 'Batch Ship' : selectedCarrier.toUpperCase()} CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-green-400 text-green-700 hover:bg-green-50"
            disabled={bookingLabels}
            onClick={() => handleBookLabels(exportableOrders.filter((o) => selectedIds.has(o.id)))}
          >
            <Truck className="h-3 w-3 mr-1" />
            {bookingLabels ? 'Booking...' : 'Book Labels'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleMarkShipped}>
            <Truck className="h-3 w-3 mr-1" />
            Mark All as Shipped
          </Button>
        </div>
      )}

      {bundleMode && selectedBuyerKeys.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-sm font-medium text-amber-800">
            {selectedBuyerKeys.size} buyer{selectedBuyerKeys.size !== 1 ? 's' : ''} selected &mdash;{' '}
            {bundleGroups.filter((g) => selectedBuyerKeys.has(g.buyerUsername)).reduce((s, g) => s + g.orders.length, 0)} orders
          </span>
          <Select value={selectedCarrier} onValueChange={(value) => value && setSelectedCarrier(value)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Select carrier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="dpd">DPD</SelectItem>
              <SelectItem value="fedex">FedEx</SelectItem>
            </SelectContent>
          </Select>
          {selectedCarrier === 'dpd' && (
            <Select value={selectedDPDService} onValueChange={(value) => value && setSelectedDPDService(value as DPDService)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="next_day">NEXT DAY</SelectItem>
                <SelectItem value="by_1030">BY 10:30</SelectItem>
                <SelectItem value="saturday_by_1030">SATURDAY BY 10:30</SelectItem>
                <SelectItem value="by_12">BY 12</SelectItem>
                <SelectItem value="sunday_by_12">SUNDAY BY 12</SelectItem>
                <SelectItem value="saturday_by_12">SATURDAY BY 12</SelectItem>
                <SelectItem value="saturday">SATURDAY</SelectItem>
                <SelectItem value="sunday">SUNDAY</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button size="sm" onClick={handleExportBundles} className="bg-amber-600 hover:bg-amber-700">
            <Download className="h-3 w-3 mr-1" />
            Download {selectedCarrier === 'standard' ? 'Bundled Labels' : selectedCarrier.toUpperCase() + ' Bundled'} CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-green-400 text-green-700 hover:bg-green-50"
            disabled={bookingLabels}
            onClick={() => {
              const selectedOrders = bundleGroups
                .filter((g) => selectedBuyerKeys.has(g.buyerUsername))
                .flatMap((g) => g.orders);
              handleBookLabels(selectedOrders);
            }}
          >
            <Truck className="h-3 w-3 mr-1" />
            {bookingLabels ? 'Booking...' : 'Book Labels'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleMarkBundlesShipped}>
            <Truck className="h-3 w-3 mr-1" />
            Mark All as Shipped
          </Button>
        </div>
      )}

      {/* ── INDIVIDUAL MODE ─────────────────────────────────────── */}
      {!bundleMode && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Orders Ready for Shipping ({filteredShipmentGroups.length})
              {filterCarrier !== 'all' && <span className="text-sm font-normal text-slate-500 ml-2">filtered</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredShipmentGroups.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Truck className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p>No orders pending shipment</p>
              </div>
            ) : (
              <div className="overflow-x-auto" style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow className="bg-slate-50">
                    <TableHead className="w-10 bg-slate-50">
                      <button onClick={toggleAll} className="p-1">
                        {selectedIds.size === filteredShipmentGroups.length && filteredShipmentGroups.length > 0 ? (
                          <CheckSquare className="h-4 w-4 text-blue-600" />
                        ) : selectedIds.size > 0 ? (
                          <MinusSquare className="h-4 w-4 text-blue-400" />
                        ) : (
                          <Square className="h-4 w-4 text-slate-400" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="text-xs cursor-pointer hover:bg-slate-100 bg-slate-50" onClick={() => handleSort('salesRecordNumber')}>Order # {sortField === 'salesRecordNumber' && (sortDir === 'asc' ? '▲' : '▼')}</TableHead>
                    <TableHead className="text-xs cursor-pointer hover:bg-slate-100 bg-slate-50" onClick={() => handleSort('postToName')}>Recipient {sortField === 'postToName' && (sortDir === 'asc' ? '▲' : '▼')}</TableHead>
                    <TableHead className="text-xs bg-slate-50">Address</TableHead>
                    <TableHead className="text-xs bg-slate-50">Postcode</TableHead>
                    <TableHead className="text-xs cursor-pointer hover:bg-slate-100 bg-slate-50" onClick={() => handleSort('postByDate')}>Post By {sortField === 'postByDate' && (sortDir === 'asc' ? '▲' : '▼')}</TableHead>
                    <TableHead className="text-xs cursor-pointer hover:bg-slate-100 bg-slate-50" onClick={() => handleSort('itemTitle')}>Item {sortField === 'itemTitle' && (sortDir === 'asc' ? '▲' : '▼')}</TableHead>
                    <TableHead className="text-xs bg-slate-50">Qty</TableHead>
                    <TableHead className="text-xs bg-slate-50">Price</TableHead>
                    <TableHead className="text-xs bg-slate-50">Boxes</TableHead>
                    <TableHead className="text-xs bg-slate-50">Carrier</TableHead>
                    <TableHead className="text-xs bg-slate-50">Service</TableHead>
                    <TableHead className="text-xs bg-slate-50">Tracking #</TableHead>
                    <TableHead className="text-xs bg-slate-50">Status</TableHead>
                    <TableHead className="text-xs bg-slate-50">Ext. Liability</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredShipmentGroups.map((group) => {
                    const { primary, combinedTitle, totalPrice, deliveryCarrier, deliveryType, isMultiItem, ids } = group;
                    const groupKey = primary.salesRecordNumber || primary.id;
                    const isSelected = ids.some((id) => selectedIds.has(id));
                    return (
                      <TableRow key={groupKey} className={`${getOrderRowClass(primary)} ${isMultiItem && getOrderRowClass(primary) === '' ? 'bg-amber-50' : ''}`.trim()}>
                        <TableCell>
                          <button onClick={() => ids.forEach((id) => toggleSelect(id))} className="p-1">
                            {isSelected ? (
                              <CheckSquare className="h-4 w-4 text-blue-600" />
                            ) : (
                              <Square className="h-4 w-4 text-slate-400" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {primary.amazonOrderId || primary.salesRecordNumber}
                          {isMultiItem && <span title="Multi-item order"><PackageOpen className="h-3 w-3 inline ml-1 text-amber-500" /></span>}
                        </TableCell>
                        <TableCell className="text-xs font-medium">
                          <div>{primary.postToName}</div>
                          <DeliveryBadge deliveryType={deliveryType} deliveryCarrier={deliveryCarrier} />
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 max-w-[200px] truncate">
                          {primary.postToAddress1}, {primary.postToCity}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{primary.postToPostcode}</TableCell>
                        <TableCell className="text-xs text-slate-600 whitespace-nowrap">
                          {primary.postByDate ? new Date(primary.postByDate).toLocaleDateString('en-GB') : '—'}
                        </TableCell>
                        <TableCell className="text-xs max-w-[220px]">
                          {isMultiItem ? (
                            <ul className="space-y-0.5">
                              {combinedTitle.split(' + ').map((line, i) => (
                                <li key={i} className="truncate text-slate-700 leading-tight">
                                  {i > 0 && <span className="text-slate-300 mr-1">+</span>}
                                  {line}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="truncate block">{combinedTitle}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-bold text-center">
                          {group.totalQuantity}
                        </TableCell>
                        <TableCell className="text-xs font-medium whitespace-nowrap">
                          £{totalPrice.toFixed(2)}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1">
                              <button
                                className="w-5 h-5 rounded border border-slate-300 text-slate-600 text-xs hover:bg-slate-100 flex items-center justify-center leading-none"
                                onClick={() => updateOrderNumberOfBoxes(primary.id, Math.max(1, (primary.numberOfBoxes ?? 1) - 1))}
                              >−</button>
                              <span className="text-xs font-medium w-4 text-center">{primary.numberOfBoxes ?? 1}</span>
                              <button
                                className="w-5 h-5 rounded border border-slate-300 text-slate-600 text-xs hover:bg-slate-100 flex items-center justify-center leading-none"
                                onClick={() => updateOrderNumberOfBoxes(primary.id, (primary.numberOfBoxes ?? 1) + 1)}
                              >+</button>
                            </div>
                            {(primary.numberOfBoxes ?? 1) > 1 && (
                              <span className="text-xs bg-amber-100 text-amber-700 border border-amber-300 rounded px-1 leading-tight whitespace-nowrap">
                                {primary.numberOfBoxes} labels
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={primary.deliveryCarrier || 'FedEx'}
                            onValueChange={(v) => ids.forEach((id) => updateOrderCarrier(id, v as DeliveryCarrier, primary.deliveryType || 'standard'))}
                          >
                            <SelectTrigger className="h-7 text-xs w-[90px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(['DPD', 'FedEx', 'Parcelforce', 'Royal Mail', 'Other'] as DeliveryCarrier[]).map((c) => (
                                <SelectItem key={c} value={c}>{c}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {primary.deliveryCarrier === 'DPD' ? (
                            <Select
                              value={(['next_day','by_1030','saturday_by_1030','by_12','sunday_by_12','saturday_by_12','saturday','sunday'] as string[]).includes(primary.deliveryService ?? '') ? primary.deliveryService! : 'next_day'}
                              onValueChange={(v) => v && ids.forEach((id) => updateOrderDeliveryService(id, v))}
                            >
                              <SelectTrigger className="h-7 text-xs w-[120px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="next_day">NEXT DAY</SelectItem>
                                <SelectItem value="by_1030">BY 10:30</SelectItem>
                                <SelectItem value="saturday_by_1030">SAT BY 10:30</SelectItem>
                                <SelectItem value="by_12">BY 12</SelectItem>
                                <SelectItem value="sunday_by_12">SUN BY 12</SelectItem>
                                <SelectItem value="saturday_by_12">SAT BY 12</SelectItem>
                                <SelectItem value="saturday">SATURDAY</SelectItem>
                                <SelectItem value="sunday">SUNDAY</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Select
                              value={primary.deliveryType || 'standard'}
                              onValueChange={(v) => ids.forEach((id) => updateOrderCarrier(id, primary.deliveryCarrier || 'FedEx', v as DeliveryType))}
                            >
                              <SelectTrigger className="h-7 text-xs w-[90px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="standard">Standard</SelectItem>
                                <SelectItem value="next_day">Next Day</SelectItem>
                                <SelectItem value="express">Express</SelectItem>
                                <SelectItem value="collection">Collection</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <TrackingCell
                            orderId={primary.id}
                            trackingNumber={primary.trackingNumber}
                            labelCarrier={primary.labelCarrier}
                            deliveryCarrier={primary.deliveryCarrier}
                            updateOrderTracking={updateOrderTracking}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant="outline" className={`text-xs ${ORDER_STATUS_CONFIG[primary.status].color}`}>
                              {ORDER_STATUS_CONFIG[primary.status].label}
                            </Badge>
                            {primary.labelPrintedAt ? (
                              <span
                                className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-300 rounded px-1.5 py-0.5 whitespace-nowrap"
                                title={`Label booked ${new Date(primary.labelPrintedAt).toLocaleString('en-GB')}`}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Label booked</span>
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={primary.extendedLiability || false}
                            onChange={(e) => ids.forEach((id) => updateOrderExtendedLiability(id, e.target.checked))}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            title="Extended Liability"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── BUNDLE MODE ──────────────────────────────────────────── */}
      {bundleMode && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Buyers ({filteredBundleGroups.length}) &mdash; {filteredBundleGroups.reduce((s, g) => s + g.orders.length, 0)} orders total
              </CardTitle>
              <button onClick={toggleAllBuyers} className="p-1">
                {selectedBuyerKeys.size === filteredBundleGroups.length && filteredBundleGroups.length > 0 ? (
                  <CheckSquare className="h-4 w-4 text-blue-600" />
                ) : selectedBuyerKeys.size > 0 ? (
                  <MinusSquare className="h-4 w-4 text-blue-400" />
                ) : (
                  <Square className="h-4 w-4 text-slate-400" />
                )}
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {filteredBundleGroups.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Truck className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p>No orders pending shipment</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredBundleGroups.map((group) => {
                  const isMulti = group.orders.length > 1;
                  const isExpanded = expandedBuyers.has(group.buyerUsername);
                  const isSelected = selectedBuyerKeys.has(group.buyerUsername);
                  const totalValue = group.orders.reduce((s, o) => s + o.totalPrice, 0);

                  return (
                    <div
                      key={group.buyerUsername}
                      className={`border rounded-lg overflow-hidden ${isMulti ? 'border-amber-300' : 'border-slate-200'}`}
                    >
                      {/* Group header row */}
                      <div className={`flex items-center gap-3 px-3 py-2.5 ${isMulti ? 'bg-amber-50' : 'bg-slate-50'}`}>
                        <button onClick={() => toggleBuyerSelect(group.buyerUsername)} className="p-0.5 shrink-0">
                          {isSelected ? (
                            <CheckSquare className="h-4 w-4 text-blue-600" />
                          ) : (
                            <Square className="h-4 w-4 text-slate-400" />
                          )}
                        </button>
                        <button
                          onClick={() => toggleBuyerExpand(group.buyerUsername)}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        >
                          {isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          }
                          <span className="text-sm font-medium truncate">{group.buyerName}</span>
                          {group.buyerUsername !== group.buyerName && (
                            <span className="text-xs text-slate-400 truncate">({group.buyerUsername})</span>
                          )}
                        </button>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-slate-500">
                            {group.orders[0].postToPostcode}
                          </span>
                          <span className="text-xs font-medium">£{totalValue.toFixed(2)}</span>
                          <Badge
                            variant="outline"
                            className={`text-xs ${isMulti ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-slate-100 text-slate-600 border-slate-300'}`}
                          >
                            {group.orders.length} order{group.orders.length !== 1 ? 's' : ''}
                          </Badge>
                        </div>
                      </div>

                      {/* Expanded order rows */}
                      {isExpanded && (
                        <div className="divide-y divide-slate-100">
                          {group.orders.map((order) => (
                            <div key={order.id} className="flex items-center gap-3 px-4 py-2 bg-white text-xs">
                              <span className="font-mono text-slate-400 w-20 shrink-0">{order.salesRecordNumber}</span>
                              <span className="flex-1 truncate text-slate-700">{order.itemTitle}</span>
                              <span className="text-slate-500 whitespace-nowrap">×{order.quantity}</span>
                              <span className="font-medium whitespace-nowrap">£{order.totalPrice.toFixed(2)}</span>
                              <Badge variant="outline" className={`text-xs ${ORDER_STATUS_CONFIG[order.status].color}`}>
                                {ORDER_STATUS_CONFIG[order.status].label}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
