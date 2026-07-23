'use client';

import { useState } from 'react';
import { useOrderStore } from '@/lib/store';
import type { QuickActionContext } from './quick-actions';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { XCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

// eBay's own seller-cancellation reasons (mirrors the eBay "Cancel order" screen).
// A cancellation happens BEFORE the item ships, so there is no return case — this
// marks the order cancelled and raises an urgent Comms ticket to handle the buyer
// refund/communication (the actual eBay refund stays a deliberate manual step).
const CANCEL_REASONS: { value: string; label: string }[] = [
  { value: 'OUT_OF_STOCK_OR_CANNOT_FULFILL', label: 'Out of stock or damaged' },
  { value: 'BUYER_ASKED_TO_CANCEL', label: 'Buyer asked to cancel' },
  { value: 'ADDRESS_ISSUES', label: "Issue with buyer's delivery address" },
];

export function CancellationDialog({ context, onClose }: { context: QuickActionContext; onClose: () => void }) {
  const orders = useOrderStore((s) => s.orders);
  const softCancelOrder = useOrderStore((s) => s.softCancelOrder);

  const order =
    (context.orderId && orders.find((o) => o.id === context.orderId)) ||
    orders.find((o) => o.salesRecordNumber === context.salesRecordNumber || o.orderNumber === context.orderNumber) ||
    null;

  const [reason, setReason] = useState(CANCEL_REASONS[0].value);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const orderNumber = order?.orderNumber || context.orderNumber || context.salesRecordNumber || '—';
  const buyer = order?.buyerUsername || context.buyerUsername || '—';
  const total = order ? `£${order.totalPrice.toFixed(2)}` : '—';
  const purchased = order?.saleDate ? new Date(order.saleDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const submit = () => {
    if (!order) {
      toast.error('Order not found locally — open it from the order sheet to cancel.');
      return;
    }
    setSubmitting(true);
    const reasonLabel = CANCEL_REASONS.find((r) => r.value === reason)?.label ?? reason;
    softCancelOrder(order.id, [reasonLabel, note.trim()].filter(Boolean).join(' — '));
    toast.success(`Order #${order.salesRecordNumber} cancelled — Comms notified to refund the buyer.`);
    setSubmitting(false);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-600" /> Cancel order
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Reason for cancellation */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Reason for cancellation</label>
            <Select value={reason} onValueChange={(v) => v && setReason(v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CANCEL_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Optional note to Comms */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Note for Comms <span className="text-slate-400 font-normal">(optional)</span></label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything the Comms team should know…"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Summary panel — mirrors eBay's cancellation summary */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Summary</p>
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Order number</dt>
              <dd className="text-slate-900 font-mono text-right">{orderNumber}</dd>
              <dt className="text-slate-500">Order total</dt>
              <dd className="text-slate-900 font-medium text-right">{total}</dd>
              <dt className="text-slate-500">Buyer</dt>
              <dd className="text-slate-900 text-right">{buyer}</dd>
              <dt className="text-slate-500">Date purchased</dt>
              <dd className="text-slate-900 text-right">{purchased}</dd>
            </dl>
          </div>

          {!order && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              This order isn&apos;t in the local order sheet yet, so it can&apos;t be cancelled here. Open it from the order sheet once it syncs.
            </div>
          )}

          <p className="text-xs text-slate-400">
            Cancelling marks the order as cancelled and raises an urgent Comms ticket to refund the buyer. It doesn&apos;t create a return case.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Keep order</Button>
          <Button className="bg-red-600 hover:bg-red-700" onClick={submit} disabled={submitting || !order}>
            Cancel order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
