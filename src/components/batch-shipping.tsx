'use client';

import { useState, useMemo } from 'react';
import { useOrderStore } from '@/lib/store';
import { ORDER_STATUS_CONFIG, DeliveryCarrier, DeliveryType } from '@/lib/types';
import { generateBatchShipCSV, generateBundledShipCSV, generateCarrierCSV, generateCarrierBundleCSV, groupOrdersByBuyer, BundleGroup } from '@/lib/csv-parser';
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
import { Download, Truck, CheckSquare, MinusSquare, Square, PackageOpen, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { toast } from 'sonner';

export function BatchShipping() {
  const orders = useOrderStore((s) => s.orders);
  const bulkUpdateStatus = useOrderStore((s) => s.bulkUpdateStatus);
  const updateOrderCarrier = useOrderStore((s) => s.updateOrderCarrier);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bundleMode, setBundleMode] = useState(false);
  const [expandedBuyers, setExpandedBuyers] = useState<Set<string>>(new Set());
  const [selectedBuyerKeys, setSelectedBuyerKeys] = useState<Set<string>>(new Set());
  const [selectedCarrier, setSelectedCarrier] = useState<string>('standard');

  // Show orders that are pending or packed (ready for shipping)
  const shippableOrders = useMemo(
    () => orders.filter((o) => o.status === 'pending' || o.status === 'packed'),
    [orders]
  );

  const bundleGroups = useMemo(
    () => groupOrdersByBuyer(shippableOrders),
    [shippableOrders]
  );

  const multiOrderBuyers = useMemo(
    () => bundleGroups.filter((g) => g.orders.length > 1),
    [bundleGroups]
  );

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === shippableOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(shippableOrders.map((o) => o.id)));
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
    if (selectedBuyerKeys.size === bundleGroups.length) {
      setSelectedBuyerKeys(new Set());
    } else {
      setSelectedBuyerKeys(new Set(bundleGroups.map((g) => g.buyerUsername)));
    }
  };

  const handleExport = () => {
    const selected = orders.filter((o) => selectedIds.has(o.id));
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Batch Shipping</h2>
          <p className="text-slate-500 text-sm mt-1">
            Generate shipping CSVs for DPD/FedEx/Parcelforce batch upload
          </p>
        </div>
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

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-yellow-600">
              {orders.filter((o) => o.status === 'pending').length}
            </div>
            <p className="text-sm text-slate-500">Pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-blue-600">
              {orders.filter((o) => o.status === 'packed').length}
            </div>
            <p className="text-sm text-slate-500">Packed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-600">
              {multiOrderBuyers.length}
            </div>
            <p className="text-sm text-slate-500">Buyers with multiple orders</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-slate-600">
              {bundleMode ? selectedBuyerKeys.size : selectedIds.size}
            </div>
            <p className="text-sm text-slate-500">{bundleMode ? 'Buyers selected' : 'Orders selected'}</p>
          </CardContent>
        </Card>
      </div>

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
          <Button size="sm" onClick={handleExport}>
            <Download className="h-3 w-3 mr-1" />
            Download {selectedCarrier === 'standard' ? 'Batch Ship' : selectedCarrier.toUpperCase()} CSV
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
          <Button size="sm" onClick={handleExportBundles} className="bg-amber-600 hover:bg-amber-700">
            <Download className="h-3 w-3 mr-1" />
            Download {selectedCarrier === 'standard' ? 'Bundled Labels' : selectedCarrier.toUpperCase() + ' Bundled'} CSV
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
              Orders Ready for Shipping ({shippableOrders.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {shippableOrders.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Truck className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p>No orders pending shipment</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <button onClick={toggleAll} className="p-1">
                        {selectedIds.size === shippableOrders.length && shippableOrders.length > 0 ? (
                          <CheckSquare className="h-4 w-4 text-blue-600" />
                        ) : selectedIds.size > 0 ? (
                          <MinusSquare className="h-4 w-4 text-blue-400" />
                        ) : (
                          <Square className="h-4 w-4 text-slate-400" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="text-xs">Order #</TableHead>
                    <TableHead className="text-xs">Recipient</TableHead>
                    <TableHead className="text-xs">Address</TableHead>
                    <TableHead className="text-xs">Postcode</TableHead>
                    <TableHead className="text-xs">Item</TableHead>
                    <TableHead className="text-xs">Price</TableHead>
                    <TableHead className="text-xs">Carrier</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shippableOrders.map((order) => {
                    const isMulti = (bundleGroups.find((g) => g.buyerUsername === (order.buyerUsername || order.buyerEmail || order.postToName))?.orders.length ?? 1) > 1;
                    return (
                      <TableRow key={order.id} className={isMulti ? 'bg-amber-50' : ''}>
                        <TableCell>
                          <button onClick={() => toggleSelect(order.id)} className="p-1">
                            {selectedIds.has(order.id) ? (
                              <CheckSquare className="h-4 w-4 text-blue-600" />
                            ) : (
                              <Square className="h-4 w-4 text-slate-400" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {order.salesRecordNumber}
                          {isMulti && <span title="Multiple orders from this buyer"><PackageOpen className="h-3 w-3 inline ml-1 text-amber-500" /></span>}
                        </TableCell>
                        <TableCell className="text-xs font-medium">{order.postToName}</TableCell>
                        <TableCell className="text-xs text-slate-600 max-w-[200px] truncate">
                          {order.postToAddress1}, {order.postToCity}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{order.postToPostcode}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{order.itemTitle}</TableCell>
                        <TableCell className="text-xs font-medium whitespace-nowrap">
                          £{order.totalPrice.toFixed(2)}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={order.deliveryCarrier || 'FedEx'}
                            onValueChange={(v) => updateOrderCarrier(order.id, v as DeliveryCarrier, order.deliveryType || 'standard')}
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
                          <Select
                            value={order.deliveryType || 'standard'}
                            onValueChange={(v) => updateOrderCarrier(order.id, order.deliveryCarrier || 'FedEx', v as DeliveryType)}
                          >
                            <SelectTrigger className="h-7 text-xs w-[90px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="standard">Standard</SelectItem>
                              <SelectItem value="next_day">Next Day</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${ORDER_STATUS_CONFIG[order.status].color}`}>
                            {ORDER_STATUS_CONFIG[order.status].label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
                Buyers ({bundleGroups.length}) &mdash; {shippableOrders.length} orders total
              </CardTitle>
              <button onClick={toggleAllBuyers} className="p-1">
                {selectedBuyerKeys.size === bundleGroups.length && bundleGroups.length > 0 ? (
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
            {bundleGroups.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Truck className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p>No orders pending shipment</p>
              </div>
            ) : (
              <div className="space-y-2">
                {bundleGroups.map((group) => {
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
