'use client';

import { Order } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Printer, Package, CheckCircle, FileText } from 'lucide-react';
import { useOrderStore } from '@/lib/store';
import { fetchPrinterConfig, printLabel, printerForCarrier, printInvoicesFor, isZplBase64 } from '@/lib/print-agent';
import { isWebUsbAvailable, printRawToUsbPrinter } from '@/lib/webusb-print';
import { buildInvoicesHtml, printHtml } from '@/lib/order-utils';
import { useEffect, useState } from 'react';
import { useSettingBool, useSettingNumber } from '@/hooks/use-settings';

interface Props {
  order: Order;
  onClose: () => void;
}

type Carrier = 'DPD' | 'FedEx';

export function LabelPrintDialog({ order, onClose }: Props) {
  const updateOrderStatus = useOrderStore((s) => s.updateOrderStatus);
  const combineLabelAndInvoice = useSettingBool('print.combineLabelAndInvoice');
  const invoiceCopies = useSettingNumber('print.copiesPerInvoice');

  const carrier: Carrier | null =
    order.labelCarrier === 'DPD' || order.labelCarrier === 'FedEx'
      ? order.labelCarrier
      : order.deliveryCarrier === 'DPD' || order.deliveryCarrier === 'FedEx'
      ? order.deliveryCarrier
      : null;

  const hasLabelData = (order.labelData?.length ?? 0) > 0;
  const canPrint = hasLabelData;

  // Is a printer mapped for this carrier on the print agent? If so, we can send
  // the label straight to the FedEx/DPD printer instead of the browser dialog.
  const [agentPrinter, setAgentPrinter] = useState<string | null>(null);
  // WebUSB (Chrome/Edge) lets us print raw ZPL straight to a USB-connected label
  // printer. Checked after mount to avoid an SSR/hydration mismatch.
  const [usbAvailable, setUsbAvailable] = useState(false);
  useEffect(() => { setUsbAvailable(isWebUsbAvailable()); }, []);
  useEffect(() => {
    let alive = true;
    if (!carrier) return;
    fetchPrinterConfig().then((cfg) => {
      if (alive) setAgentPrinter(cfg.agentUrl ? (printerForCarrier(cfg, carrier) || null) : null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [carrier]);

  async function printViaAgent() {
    const labels = order.labelData ?? [];
    if (!labels.length || !carrier) { toast.error('No label PDF available'); return; }
    try {
      let sent = 0;
      for (const data of labels) {
        const ok = await printLabel(carrier, data, undefined, `Label-${order.salesRecordNumber}`);
        if (ok) sent++;
      }
      if (sent > 0) toast.success(`Sent ${sent} label${sent !== 1 ? 's' : ''} to ${agentPrinter}`);
      else toast.error('Print agent not configured for this carrier');
    } catch (e) {
      toast.error(`Print failed: ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  async function printLabels() {
    const labels = order.labelData ?? [];
    if (!labels.length) { toast.error('No label available'); return; }
    for (let i = 0; i < labels.length; i++) {
      const data = labels[i];
      if (isZplBase64(data)) {
        // FedEx thermal labels MUST reach the printer as raw ZPL — never as a
        // rendered image (rendering distorts the barcodes and fails FedEx
        // certification). So: WebUSB straight to the printer, else hand back the
        // raw .zpl to print raw. No image conversion, ever.
        const zplBytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        if (isWebUsbAvailable()) {
          const r = await printRawToUsbPrinter(zplBytes);
          if (r.ok) { toast.success('Printed to the USB label printer'); continue; }
          // A real failure (device held by Windows, transfer error): tell the user
          // exactly what happened rather than silently downloading.
          if (r.reason === 'failed') { toast.error(r.message, { duration: 12000 }); continue; }
          // 'cancelled'/'unsupported' → fall through to the raw download.
        }
        // No direct raw path → download the raw ZPL so it can be sent to the
        // printer unmodified (configure the print agent, or use Chrome for USB).
        const dl = URL.createObjectURL(new Blob([zplBytes], { type: 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = dl; a.download = `label-${order.salesRecordNumber}-${i + 1}.zpl`; a.click();
        URL.revokeObjectURL(dl);
        toast.info('Raw ZPL downloaded. For direct printing use Chrome (USB) or the print agent — never print it as an image.');
        continue;
      }
      const isHtml = data.trimStart().startsWith('<');
      if (isHtml) {
        const win = window.open('', `_label_${i}`);
        if (!win) { toast.error('Pop-up blocked — allow pop-ups to print'); return; }
        win.document.open();
        win.document.write(data);
        win.document.close();
      } else {
        const win = window.open('', `_label_${i}`);
        if (!win) { toast.error('Pop-up blocked — allow pop-ups to print'); return; }
        win.document.write(`
          <html><body style="margin:0">
          <embed src="data:application/pdf;base64,${data}" width="100%" height="100%" type="application/pdf"/>
          </body></html>`);
        win.document.close();
        win.onload = () => win.print();
      }
    }
  }

  // Invoice — via the print-agent invoice printer when configured, otherwise
  // the browser print dialog (same fallback as InvoicePreviewDialog).
  async function printInvoice() {
    const copies = Math.max(1, invoiceCopies || 1);
    try {
      const cfg = await fetchPrinterConfig();
      if (cfg.agentUrl && cfg.invoicePrinter) {
        let ok = true;
        for (let i = 0; i < copies; i++) ok = (await printInvoicesFor([order], cfg)) && ok;
        if (ok) { toast.success(`Invoice sent to invoice printer${copies > 1 ? ` (${copies} copies)` : ''}`); return; }
      }
      for (let i = 0; i < copies; i++) printHtml(buildInvoicesHtml([order]));
    } catch {
      for (let i = 0; i < copies; i++) printHtml(buildInvoicesHtml([order]));
    }
  }

  // One tap at the packing bench: label to the carrier printer + invoice to the
  // invoice printer (each falling back to a browser print window).
  async function printBoth() {
    if (canPrint) {
      if (agentPrinter) await printViaAgent();
      else await printLabels();
    }
    await printInvoice();
  }

  function markPacked() {
    updateOrderStatus(order.id, 'packed');
    toast.success('Order moved to Packed');
    onClose();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-4 w-4" />
            Print Label &amp; Invoice — #{order.salesRecordNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Order summary */}
          <div className="text-sm bg-slate-50 rounded-lg p-3 border border-slate-200 space-y-1">
            <p className="font-medium truncate">{order.itemTitle}</p>
            <p className="text-slate-500 text-xs">{order.postToName} · {order.postToPostcode}</p>
            {order.variation && (
              <p className="text-amber-700 text-xs font-medium">⚠ {order.variation}</p>
            )}
          </div>

          {/* Carrier */}
          {carrier && (
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1.5 block">Carrier</label>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${
                  carrier === 'DPD'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-purple-50 text-purple-700 border-purple-200'
                }`}>
                  {canPrint && <CheckCircle className="h-3.5 w-3.5" />}
                  {carrier}
                </span>
                {canPrint && order.labelPrintedAt && (
                  <span className="text-xs text-slate-400">
                    Booked {new Date(order.labelPrintedAt).toLocaleDateString('en-GB')}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Tracking number */}
          {order.trackingNumber && (
            <div className="bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-slate-500">Tracking number</span>
              <span className="text-sm font-mono font-medium text-slate-800">
                {order.trackingNumber}
              </span>
            </div>
          )}

          {/* No label message */}
          {!canPrint && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <p className="font-medium">No label booked yet</p>
              <p className="text-xs text-amber-600 mt-0.5">
                Labels are booked and tracking numbers assigned in Batch Shipping. This dialog is only for printing the stored label at the packing stage.
              </p>
            </div>
          )}

          {/* Actions — one combined tap for the packing bench, or each separately */}
          <div className="flex flex-col gap-2 pt-1">
            {canPrint && combineLabelAndInvoice && (
              <Button onClick={printBoth} className="w-full bg-green-600 hover:bg-green-700">
                <Printer className="h-4 w-4 mr-2" />
                Print Label + Invoice
              </Button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => (canPrint && agentPrinter ? printViaAgent() : printLabels())}
                variant="outline"
                disabled={!canPrint}
                title={!canPrint ? 'No label booked yet — book it in Batch Shipping' : agentPrinter ? `Sends to ${agentPrinter}` : 'Opens the browser print dialog'}
              >
                <Printer className="h-4 w-4 mr-2" />
                Label only
              </Button>
              <Button onClick={printInvoice} variant="outline">
                <FileText className="h-4 w-4 mr-2" />
                Invoice only
              </Button>
            </div>
            {canPrint && agentPrinter && (
              <button onClick={printLabels} className="text-xs text-slate-400 hover:text-slate-600 underline w-fit mx-auto">
                Print label via browser instead
              </button>
            )}
            {canPrint && !agentPrinter && usbAvailable && (
              <p className="text-[11px] text-slate-400 text-center">
                Prints straight to the USB label printer. The first time, your browser asks which printer to use.
              </p>
            )}

            <Button
              variant="outline"
              onClick={markPacked}
              className="w-full"
            >
              <Package className="h-4 w-4 mr-2" />
              Mark as Packed &amp; Continue
            </Button>

            <Button variant="ghost" onClick={onClose} className="w-full text-slate-500">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
