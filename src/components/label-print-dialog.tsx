'use client';

import { Order } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Printer, Package, CheckCircle, FileText } from 'lucide-react';
import { useOrderStore } from '@/lib/store';
import { fetchPrinterConfig, printLabel, printerForCarrier, printInvoicesFor } from '@/lib/print-agent';
import { buildInvoicesHtml, printHtml } from '@/lib/order-utils';
import { useEffect, useState } from 'react';

interface Props {
  order: Order;
  onClose: () => void;
}

type Carrier = 'DPD' | 'FedEx';

export function LabelPrintDialog({ order, onClose }: Props) {
  const updateOrderStatus = useOrderStore((s) => s.updateOrderStatus);

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

  function printLabels() {
    const labels = order.labelData ?? [];
    if (!labels.length) { toast.error('No label PDF available'); return; }
    labels.forEach((data, i) => {
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
    });
  }

  // Invoice — via the print-agent invoice printer when configured, otherwise
  // the browser print dialog (same fallback as InvoicePreviewDialog).
  async function printInvoice() {
    try {
      const cfg = await fetchPrinterConfig();
      if (cfg.agentUrl && cfg.invoicePrinter && (await printInvoicesFor([order], cfg))) {
        toast.success('Invoice sent to invoice printer');
        return;
      }
      printHtml(buildInvoicesHtml([order]));
    } catch {
      printHtml(buildInvoicesHtml([order]));
    }
  }

  // One tap at the packing bench: label to the carrier printer + invoice to the
  // invoice printer (each falling back to a browser print window).
  async function printBoth() {
    if (canPrint) {
      if (agentPrinter) await printViaAgent();
      else printLabels();
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
            {canPrint && (
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
