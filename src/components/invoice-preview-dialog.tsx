'use client';

import { useMemo, useState } from 'react';
import { Order } from '@/lib/types';
import { buildInvoicesHtml, printHtml } from '@/lib/order-utils';
import { fetchPrinterConfig, printInvoicesFor } from '@/lib/print-agent';
import { Button } from '@/components/ui/button';
import { X, Printer } from 'lucide-react';
import { toast } from 'sonner';

// View (and print) the invoice for one or more orders. Available at every queue
// stage so packers can see the invoice on screen. Prints via the print agent
// when configured, otherwise falls back to the browser print dialog.
export function InvoicePreviewDialog({ orders, onClose }: { orders: Order[]; onClose: () => void }) {
  const html = useMemo(() => buildInvoicesHtml(orders), [orders]);
  const [printing, setPrinting] = useState(false);

  async function printInvoice() {
    setPrinting(true);
    try {
      const cfg = await fetchPrinterConfig();
      if (cfg.agentUrl && cfg.invoicePrinter && (await printInvoicesFor(orders, cfg))) {
        toast.success('Sent to invoice printer');
        return;
      }
      printHtml(html); // browser fallback
    } catch (e) {
      toast.error(`Print failed: ${e instanceof Error ? e.message : 'error'}`);
      printHtml(html);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <span className="text-sm font-medium text-slate-700">
            Invoice{orders.length > 1 ? `s · ${orders.length}` : ` · #${orders[0]?.salesRecordNumber}`}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={printInvoice} disabled={printing}>
              <Printer className="h-3.5 w-3.5 mr-1.5" /> {printing ? 'Printing…' : 'Print'}
            </Button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" title="Close"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <iframe srcDoc={html} sandbox="" title="Invoice preview" className="flex-1 w-full bg-white" />
      </div>
    </div>
  );
}
