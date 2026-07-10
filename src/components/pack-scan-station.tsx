'use client';

import { useMemo, useRef, useState } from 'react';
import { Order } from '@/lib/types';
import { useOrderStore } from '@/lib/store';
import { buildInvoicesHtml, printHtml } from '@/lib/order-utils';
import { fetchPrinterConfig, printInvoicesFor, printLabel, printerForCarrier } from '@/lib/print-agent';
import { InvoicePreviewDialog } from './invoice-preview-dialog';
import { Button } from '@/components/ui/button';
import { ScanLine, Package, Printer, X, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

// Packing scan station: scan the security barcode on a finished build to pull the
// order up, confirm packed, and print its invoice + carrier label on the spot.
export function PackScanStation() {
  const orders = useOrderStore((s) => s.orders);
  const [scanned, setScanned] = useState<Order | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleScan(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const q = code.toLowerCase();
    // Prefer the security barcode; fall back to order/tracking number for flexibility.
    const match =
      orders.find((o) => !o.deletedAt && o.securityBarcode && o.securityBarcode.toLowerCase() === q) ??
      orders.find((o) => !o.deletedAt && (o.salesRecordNumber?.toLowerCase() === q || o.orderNumber?.toLowerCase() === q || o.trackingNumber?.toLowerCase() === q));
    if (match) { setScanned(match); setNotFound(null); }
    else { setNotFound(code); setScanned(null); }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3">
      <div className="flex items-center gap-2">
        <ScanLine className="h-5 w-5 text-blue-600 shrink-0" />
        <input
          ref={inputRef}
          autoFocus
          placeholder="Scan security barcode to pack…"
          onKeyDown={(e) => { if (e.key === 'Enter') { handleScan((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }}
          className="flex-1 min-w-0 px-3 py-2 border border-blue-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {notFound && (
        <p className="text-xs text-amber-700 mt-2 flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5" /> No order found for “{notFound}”. Was the label attached at assembly?
        </p>
      )}
      {scanned && (
        <ConfirmPackedDialog
          order={scanned}
          onClose={() => { setScanned(null); inputRef.current?.focus(); }}
        />
      )}
    </div>
  );
}

function ConfirmPackedDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const updateOrderStatus = useOrderStore((s) => s.updateOrderStatus);
  const [busy, setBusy] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);

  const carrier = order.labelCarrier || order.deliveryCarrier;
  const labels = useMemo(() => order.labelData ?? [], [order.labelData]);
  const hasLabel = labels.length > 0 && (carrier === 'DPD' || carrier === 'FedEx');

  async function confirmPacked() {
    setBusy(true);
    const printed: string[] = [];
    try {
      const cfg = await fetchPrinterConfig();

      // Invoice
      try {
        if (cfg.agentUrl && cfg.invoicePrinter && (await printInvoicesFor([order], cfg))) printed.push('invoice');
        else printHtml(buildInvoicesHtml([order]));
      } catch { printHtml(buildInvoicesHtml([order])); }

      // Carrier label (already booked in Batch Shipping)
      if (hasLabel) {
        const routed = cfg.agentUrl && printerForCarrier(cfg, carrier);
        if (routed) {
          let sent = 0;
          for (const l of labels) { try { if (await printLabel(carrier, l, cfg, `Label-${order.salesRecordNumber}`)) sent++; } catch { /* keep going */ } }
          if (sent) printed.push(`${carrier} label`);
        }
      }

      updateOrderStatus(order.id, 'packed');
      toast.success(printed.length ? `Packed — printed ${printed.join(' + ')}` : 'Packed', { icon: '📦' });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3 border-b">
            <h3 className="font-bold text-slate-900 flex items-center gap-2"><Package className="h-5 w-5 text-blue-600" /> Confirm packed</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>

          <div className="p-5 space-y-3">
            <div>
              <p className="text-xs font-mono text-slate-400">#{order.salesRecordNumber}</p>
              <p className="text-sm font-medium text-slate-800 leading-snug">{order.itemTitle}</p>
              <p className="text-xs text-slate-500 mt-0.5">{order.postToName} · {order.postToPostcode}</p>
              {order.variation && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-1 font-medium">⚠ {order.variation}</p>}
            </div>

            <div className="flex items-center gap-2 text-xs">
              {hasLabel ? (
                <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {carrier} label ready{order.trackingNumber ? ` · ${order.trackingNumber}` : ''}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> No label booked — book it in Batch Shipping
                </span>
              )}
            </div>

            <button onClick={() => setShowInvoice(true)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" /> View invoice
            </button>

            <div className="flex gap-2 pt-1">
              <Button onClick={confirmPacked} disabled={busy} className="flex-1">
                <Printer className="h-4 w-4 mr-1.5" /> {busy ? 'Printing…' : 'Confirm & print'}
              </Button>
              <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            </div>
          </div>
        </div>
      </div>
      {showInvoice && <InvoicePreviewDialog orders={[order]} onClose={() => setShowInvoice(false)} />}
    </>
  );
}
