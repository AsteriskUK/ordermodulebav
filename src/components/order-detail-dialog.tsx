'use client';

import { useState } from 'react';
import { Order, ORDER_STATUS_CONFIG, OrderStatus } from '@/lib/types';
import { useOrderStore } from '@/lib/store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MapPin, Package, User, Truck, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  order: Order;
  onClose: () => void;
}

export function OrderDetailDialog({ order, onClose }: Props) {
  const updateOrderStatus = useOrderStore((s) => s.updateOrderStatus);
  const updateOrderComment = useOrderStore((s) => s.updateOrderComment);
  const updateOrderTracking = useOrderStore((s) => s.updateOrderTracking);

  const [comment, setComment] = useState(order.comments);
  const [tracking, setTracking] = useState(order.trackingNumber);

  const handleSave = () => {
    updateOrderComment(order.id, comment);
    updateOrderTracking(order.id, tracking);
    toast.success('Order updated');
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Order #{order.salesRecordNumber}</span>
            <Badge
              variant="outline"
              className={ORDER_STATUS_CONFIG[order.status].color}
            >
              {ORDER_STATUS_CONFIG[order.status].label}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Status selector */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-600">Status:</span>
            <Select
              value={order.status}
              onValueChange={(v) => {
                updateOrderStatus(order.id, v as OrderStatus);
                toast.success(`Status updated to ${ORDER_STATUS_CONFIG[v as OrderStatus].label}`);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
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
          </div>

          <Separator />

          {/* Item details */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
              <Package className="h-4 w-4" /> Item Details
            </h4>
            <div className="bg-slate-50 rounded-lg p-3 space-y-1 text-sm">
              <p>
                <span className="text-slate-500">Title:</span>{' '}
                <span className="font-medium">{order.itemTitle}</span>
              </p>
              {order.customLabel && (
                <p>
                  <span className="text-slate-500">SKU/Label:</span>{' '}
                  <span className="font-mono">{order.customLabel}</span>
                </p>
              )}
              {order.variation && (
                <p>
                  <span className="text-slate-500">Variation:</span>{' '}
                  {order.variation}
                </p>
              )}
              <p>
                <span className="text-slate-500">Quantity:</span>{' '}
                {order.quantity}
              </p>
              <p>
                <span className="text-slate-500">Price:</span> £
                {order.soldFor.toFixed(2)}
              </p>
              {order.postageAndPackaging > 0 && (
                <p>
                  <span className="text-slate-500">P&P:</span> £
                  {order.postageAndPackaging.toFixed(2)}
                </p>
              )}
            </div>
          </div>

          {/* Customer */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
              <User className="h-4 w-4" /> Customer
            </h4>
            <div className="bg-slate-50 rounded-lg p-3 space-y-1 text-sm">
              <p>
                <span className="text-slate-500">Name:</span>{' '}
                {order.buyerName || order.postToName}
              </p>
              {order.buyerUsername && (
                <p>
                  <span className="text-slate-500">Username:</span>{' '}
                  {order.buyerUsername}
                </p>
              )}
              {order.buyerEmail && (
                <p>
                  <span className="text-slate-500">Email:</span>{' '}
                  {order.buyerEmail}
                </p>
              )}
              {order.buyerNote && (
                <p className="p-2 bg-yellow-50 border border-yellow-200 rounded text-yellow-800">
                  <span className="font-medium">Buyer Note:</span>{' '}
                  {order.buyerNote}
                </p>
              )}
            </div>
          </div>

          {/* Shipping address */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
              <MapPin className="h-4 w-4" /> Shipping Address
            </h4>
            <div className="bg-slate-50 rounded-lg p-3 text-sm">
              <p className="font-medium">{order.postToName}</p>
              <p>{order.postToAddress1}</p>
              {order.postToAddress2 && <p>{order.postToAddress2}</p>}
              <p>
                {order.postToCity}
                {order.postToCounty ? `, ${order.postToCounty}` : ''}
              </p>
              <p className="font-mono">{order.postToPostcode}</p>
              <p>{order.postToCountry}</p>
              {order.postToPhone && (
                <p className="mt-2 text-slate-500">
                  Tel: {order.postToPhone}
                </p>
              )}
            </div>
          </div>

          {/* Tracking */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
              <Truck className="h-4 w-4" /> Shipping & Tracking
            </h4>
            <div className="space-y-2">
              {order.deliveryService && (
                <p className="text-sm">
                  <span className="text-slate-500">Service:</span>{' '}
                  {order.deliveryService}
                </p>
              )}
              <Input
                placeholder="Enter tracking number..."
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
              />
            </div>
          </div>

          {/* Comments */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
              <MessageSquare className="h-4 w-4" /> Comments
            </h4>
            <textarea
              className="w-full border rounded-lg p-3 text-sm min-h-[80px] resize-y focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Add warehouse notes, delay reasons, etc..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
            <p>
              Sale Date:{' '}
              {order.saleDate
                ? new Date(order.saleDate).toLocaleString('en-GB')
                : '-'}
            </p>
            <p>
              Paid:{' '}
              {order.paidOnDate
                ? new Date(order.paidOnDate).toLocaleString('en-GB')
                : '-'}
            </p>
            <p>
              Post By:{' '}
              {order.postByDate
                ? new Date(order.postByDate).toLocaleString('en-GB')
                : '-'}
            </p>
            <p>
              Dispatched:{' '}
              {order.dispatchedOnDate
                ? new Date(order.dispatchedOnDate).toLocaleString('en-GB')
                : '-'}
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button onClick={handleSave}>Save Changes</Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
