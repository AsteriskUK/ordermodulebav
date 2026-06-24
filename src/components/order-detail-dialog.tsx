'use client';

import { useState, useRef, useEffect } from 'react';
import { Order, ORDER_STATUS_CONFIG, OrderStatus, OrderNote } from '@/lib/types';
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
import { MapPin, Package, User, Truck, MessageSquare, Send, Trash2, ShoppingBag } from 'lucide-react';
import { DeliveryBadge } from './delivery-badge';
import { toast } from 'sonner';

interface Props {
  order: Order;
  onClose: () => void;
}

export function OrderDetailDialog({ order, onClose }: Props) {
  const updateOrderStatus = useOrderStore((s) => s.updateOrderStatus);
  const updateOrderTracking = useOrderStore((s) => s.updateOrderTracking);
  const updateOrderNumberOfBoxes = useOrderStore((s) => s.updateOrderNumberOfBoxes);
  const addOrderNote = useOrderStore((s) => s.addOrderNote);
  const deleteOrderNote = useOrderStore((s) => s.deleteOrderNote);
  const currentUser = useOrderStore((s) => s.users.find(u => u.id === s.currentUserId));
  const liveOrder = useOrderStore((s) => s.orders.find(o => o.id === order.id)) ?? order;

  const isCommsTeam = currentUser?.role === 'comms' || currentUser?.departments?.includes('comms');

  const [tracking, setTracking] = useState(order.trackingNumber);
  const [numberOfBoxes, setNumberOfBoxes] = useState((order.numberOfBoxes ?? 1).toString());
  const [noteText, setNoteText] = useState('');
  const notesEndRef = useRef<HTMLDivElement>(null);

  // eBay messaging
  const [ebayMsgText, setEbayMsgText] = useState('');
  const [ebayMsgReason, setEbayMsgReason] = useState('SHIPPING');
  const [ebayMsgSending, setEbayMsgSending] = useState(false);
  const isEbayOrder = order.batchId?.startsWith('ebay-') || liveOrder.salesRecordNumber?.includes('-');

  const QUICK_MESSAGES = {
    SHIPPING: [
      `Hi, your order #${order.salesRecordNumber} has been dispatched and is on its way. Your tracking number is ${order.trackingNumber || '[TRACKING]'}. Please allow 2-3 working days for delivery.`,
      `Hi, we wanted to let you know there is a slight delay with your order #${order.salesRecordNumber}. We apologise for any inconvenience and will dispatch as soon as possible.`,
    ],
    ITEM: [
      `Hi, regarding your order #${order.salesRecordNumber} for "${order.itemTitle}" — could you please confirm which variation you require? ${order.variation ? `We have it listed as: ${order.variation}` : ''}`.trim(),
      `Hi, thank you for your order #${order.salesRecordNumber}. We just wanted to confirm the details are correct before we dispatch.`,
    ],
  };

  async function handleSendEbayMessage() {
    if (!ebayMsgText.trim()) return;
    if (!order.buyerUsername) {
      toast.error('No eBay buyer username found for this order');
      return;
    }
    setEbayMsgSending(true);
    try {
      const res = await fetch('/api/ebay/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.salesRecordNumber,
          itemId: order.itemNumber,
          recipientUsername: order.buyerUsername,
          contactReason: ebayMsgReason,
          text: ebayMsgText,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        toast.error(`Failed to send: ${err.message || 'Unknown error'}`);
        return;
      }
      toast.success('Message sent to buyer via eBay inbox');
      setEbayMsgText('');
    } catch {
      toast.error('Failed to send message');
    } finally {
      setEbayMsgSending(false);
    }
  }

  useEffect(() => {
    notesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveOrder.notes?.length]);

  const handleSave = () => {
    updateOrderTracking(order.id, tracking);
    updateOrderNumberOfBoxes(order.id, parseInt(numberOfBoxes) || 1);
    toast.success('Order updated');
    onClose();
  };

  const handlePostNote = () => {
    const text = noteText.trim();
    if (!text) return;
    addOrderNote(order.id, {
      text,
      authorId: currentUser?.id ?? 'unknown',
      authorName: currentUser?.name ?? 'Unknown',
    });
    setNoteText('');
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 flex-wrap">
            <span>Order #{order.salesRecordNumber}</span>
            <Badge
              variant="outline"
              className={ORDER_STATUS_CONFIG[order.status].color}
            >
              {ORDER_STATUS_CONFIG[order.status].label}
            </Badge>
            <DeliveryBadge deliveryType={order.deliveryType} deliveryCarrier={order.deliveryCarrier} size="sm" />
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

          {/* Hold/Unhold buttons for comms team only */}
          {isCommsTeam && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-600">Comms Actions:</span>
              {order.status === 'held' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    updateOrderStatus(order.id, 'pending');
                    toast.success('Order unheld and returned to pending');
                  }}
                  className="text-green-600 border-green-300 hover:bg-green-50"
                >
                  Unhold Order
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    updateOrderStatus(order.id, 'held');
                    toast.success('Order placed on hold');
                  }}
                  className="text-amber-600 border-amber-300 hover:bg-amber-50"
                >
                  Hold Order
                </Button>
              )}
            </div>
          )}

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
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-slate-500">Carrier:</span>
                <span className="text-sm font-medium">{order.deliveryCarrier}</span>
                <DeliveryBadge deliveryType={order.deliveryType} deliveryCarrier={order.deliveryCarrier} size="sm" />
                {order.postageAndPackaging > 0 && (
                  <span className="text-xs text-slate-400">(paid postage: £{order.postageAndPackaging.toFixed(2)})</span>
                )}
              </div>
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
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600">Number of Boxes:</label>
                <Select
                  value={numberOfBoxes}
                  onValueChange={(value) => value && setNumberOfBoxes(value)}
                >
                  <SelectTrigger className="w-[80px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Notes thread */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
              <MessageSquare className="h-4 w-4" /> Team Notes
              {(liveOrder.notes?.length ?? 0) > 0 && (
                <span className="ml-1 bg-blue-100 text-blue-700 text-xs rounded-full px-1.5 py-0.5 leading-none">
                  {liveOrder.notes!.length}
                </span>
              )}
            </h4>
            {/* Legacy plain comment migration */}
            {liveOrder.comments && (liveOrder.notes?.length ?? 0) === 0 && (
              <div className="mb-2 p-2 bg-slate-50 rounded text-xs text-slate-500 italic">
                {liveOrder.comments}
              </div>
            )}
            {/* Notes list */}
            <div className="space-y-2 max-h-48 overflow-y-auto mb-2 pr-1">
              {(liveOrder.notes ?? []).map((note: OrderNote) => (
                <div key={note.id} className="flex gap-2 group">
                  <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-xs font-medium text-slate-700">{note.authorName}</span>
                      <span className="text-xs text-slate-400">
                        {new Date(note.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm text-slate-800 whitespace-pre-wrap">{note.text}</p>
                  </div>
                  {(currentUser?.id === note.authorId || currentUser?.role === 'admin' || currentUser?.role === 'manager') && (
                    <button
                      onClick={() => deleteOrderNote(order.id, note.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1 text-slate-400 hover:text-red-500"
                      title="Delete note"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {(liveOrder.notes?.length ?? 0) === 0 && !liveOrder.comments && (
                <p className="text-xs text-slate-400 text-center py-3">No notes yet</p>
              )}
              <div ref={notesEndRef} />
            </div>
            {/* Compose */}
            <div className="flex gap-2">
              <textarea
                className="flex-1 border rounded-lg p-2 text-sm min-h-[60px] resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Add a note for the team..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePostNote(); }}
              />
              <button
                onClick={handlePostNote}
                disabled={!noteText.trim()}
                className="self-end px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <Send className="h-3.5 w-3.5" />
                Post
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">Ctrl+Enter to post</p>
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

          {/* eBay Buyer Messaging */}
          {isEbayOrder && (
            <div>
              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                <ShoppingBag className="h-4 w-4 text-amber-600" /> Message Buyer via eBay
              </h4>
              {!order.buyerUsername && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
                  No eBay username found for this order. Messages can only be sent to orders imported via the eBay API.
                </p>
              )}
              <div className="space-y-2">
                {/* Reason selector */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500 w-16 shrink-0">Reason:</label>
                  <Select value={ebayMsgReason} onValueChange={(v) => v && setEbayMsgReason(v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SHIPPING">Shipping update</SelectItem>
                      <SelectItem value="ITEM">Item / variation query</SelectItem>
                      <SelectItem value="ORDER">General order update</SelectItem>
                      <SelectItem value="DELAY">Dispatch delay</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Quick message templates */}
                {(QUICK_MESSAGES[ebayMsgReason as keyof typeof QUICK_MESSAGES] ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-slate-400 self-center">Quick:</span>
                    {(QUICK_MESSAGES[ebayMsgReason as keyof typeof QUICK_MESSAGES] ?? []).map((msg, i) => (
                      <button
                        key={i}
                        onClick={() => setEbayMsgText(msg)}
                        className="text-xs px-2 py-0.5 bg-slate-100 hover:bg-amber-100 border border-slate-200 rounded-full text-slate-600 hover:text-amber-700 transition-colors"
                      >
                        Template {i + 1}
                      </button>
                    ))}
                  </div>
                )}
                {/* Message textarea */}
                <textarea
                  className="w-full border rounded-lg p-2 text-sm min-h-[80px] resize-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  placeholder="Type your message to the buyer..."
                  value={ebayMsgText}
                  onChange={(e) => setEbayMsgText(e.target.value)}
                  disabled={!order.buyerUsername}
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{ebayMsgText.length}/2000 chars</span>
                  <button
                    onClick={handleSendEbayMessage}
                    disabled={!ebayMsgText.trim() || ebayMsgSending || !order.buyerUsername}
                    className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {ebayMsgSending ? 'Sending…' : 'Send to eBay Inbox'}
                  </button>
                </div>
              </div>
            </div>
          )}

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
