'use client';

import { useState } from 'react';
import { Order } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Send, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useOrderStore } from '@/lib/store';

interface Props {
  order: Order;
  onClose: () => void;
}

const REASONS = [
  { value: 'SHIPPING', label: 'Shipping update' },
  { value: 'ITEM', label: 'Item / variation query' },
  { value: 'ORDER', label: 'General order update' },
  { value: 'DELAY', label: 'Dispatch delay' },
];

export function EbayMessageDialog({ order, onClose }: Props) {
  const [reason, setReason] = useState('SHIPPING');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));

  const templates: Record<string, string[]> = {
    SHIPPING: [
      `Hi, your order #${order.salesRecordNumber} has been dispatched. Your tracking number is ${order.trackingNumber || '[TRACKING NUMBER]'}. Please allow 2–3 working days for delivery. Thank you for your purchase!`,
      `Hi, your order #${order.salesRecordNumber} has been shipped and is on its way to you. You can track it using: ${order.trackingNumber || '[TRACKING NUMBER]'}. Please don't hesitate to contact us if you have any questions.`,
    ],
    ITEM: [
      `Hi, thank you for your order #${order.salesRecordNumber} for "${order.itemTitle}". ${order.variation ? `We have your item noted as: ${order.variation}. ` : ''}Could you please confirm this is correct before we dispatch?`,
      `Hi, regarding your order #${order.salesRecordNumber} — we just wanted to check which variation you need for "${order.itemTitle}". Please reply at your earliest convenience so we can get this dispatched for you promptly.`,
    ],
    ORDER: [
      `Hi, thank you for your order #${order.salesRecordNumber}. We are currently processing it and will dispatch as soon as possible. Please feel free to message us if you have any questions.`,
    ],
    DELAY: [
      `Hi, we wanted to let you know there is a short delay with your order #${order.salesRecordNumber} for "${order.itemTitle}". We sincerely apologise for the inconvenience and will dispatch it as soon as possible. Thank you for your patience.`,
    ],
  };

  const canSend = !!order.buyerUsername;

  async function handleSend() {
    if (!text.trim() || !canSend) return;
    setSending(true);
    try {
      const res = await fetch('/api/ebay/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.salesRecordNumber,
          itemId: order.itemNumber,
          recipientUsername: order.buyerUsername,
          buyerName: order.buyerName || order.postToName,
          itemTitle: order.itemTitle,
          contactReason: reason,
          text,
          sentById: currentUser?.id,
          sentByName: currentUser?.name,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        toast.error(`Send failed: ${err.message || 'Unknown error'}`);
        return;
      }
      toast.success('Message sent to buyer via eBay inbox');
      onClose();
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-amber-600" />
            Message Buyer — Order #{order.salesRecordNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Buyer info */}
          <div className="bg-slate-50 rounded-lg px-3 py-2 text-sm space-y-0.5">
            <p><span className="text-slate-500">Buyer:</span> <span className="font-medium">{order.buyerName || order.postToName}</span></p>
            {order.buyerUsername && <p><span className="text-slate-500">eBay user:</span> <span className="font-mono text-xs">{order.buyerUsername}</span></p>}
            <p><span className="text-slate-500">Item:</span> {order.itemTitle}</p>
            {order.variation && <p><span className="text-slate-500">Variation:</span> {order.variation}</p>}
          </div>

          {!canSend && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              eBay username not available. Messages can only be sent to orders imported via the eBay API (not CSV).
            </p>
          )}

          {/* Reason */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-600 w-16 shrink-0">Reason:</label>
            <Select value={reason} onValueChange={(v) => v && setReason(v)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Templates */}
          {(templates[reason] ?? []).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-slate-400">Quick templates:</p>
              <div className="flex flex-col gap-1">
                {(templates[reason] ?? []).map((t, i) => (
                  <button
                    key={i}
                    onClick={() => setText(t)}
                    className="text-left text-xs px-3 py-2 bg-slate-100 hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-lg text-slate-600 hover:text-amber-800 transition-colors line-clamp-2"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message */}
          <div>
            <textarea
              className="w-full border rounded-lg p-3 text-sm min-h-[120px] resize-none focus:ring-2 focus:ring-amber-400 focus:border-transparent disabled:opacity-50"
              placeholder="Type your message to the buyer..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!canSend}
              maxLength={2000}
            />
            <p className="text-xs text-slate-400 text-right mt-0.5">{text.length}/2000</p>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleSend}
              disabled={!text.trim() || !canSend || sending}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Send className="h-4 w-4 mr-1.5" />
              {sending ? 'Sending…' : 'Send to eBay Inbox'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
