'use client';

import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Printer, Download, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseCSV } from '@/lib/csv-parser';
import { useOrderStore } from '@/lib/store';
import { Batch, Order } from '@/lib/types';
import { toast } from 'sonner';
import Papa from 'papaparse';

function printHtml(html: string) {
  const win = window.open('', '_blank');
  if (!win) { toast.error('Pop-up blocked — allow pop-ups and try again'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}

function buildLabelsHtml(orders: Order[]): string {
  const labels = orders.flatMap((o) => {
    const qty = o.labelQty || 1;
    return Array.from({ length: qty }, () => `
      <div class="label">
        <div class="to">
          <strong>${o.postToName}</strong><br/>
          ${o.postToAddress1}${o.postToAddress2 ? ', ' + o.postToAddress2 : ''}<br/>
          ${o.postToCity}${o.postToCounty ? ', ' + o.postToCounty : ''}<br/>
          <strong>${o.postToPostcode}</strong><br/>
          ${o.postToCountry && o.postToCountry !== 'United Kingdom' ? o.postToCountry : ''}
        </div>
        <div class="meta">
          <span class="ref">Order: ${o.salesRecordNumber}</span>
          ${o.customLabel ? `<span class="sku">SKU: ${o.customLabel}</span>` : ''}
          ${o.trackingNumber ? `<span class="tracking">${o.trackingNumber}</span>` : ''}
        </div>
      </div>`);
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Shipping Labels</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; font-size: 11px; }
    .label { width:10cm; min-height:6cm; border:2px solid #000; padding:10px; margin:8px; display:inline-block; vertical-align:top; page-break-inside:avoid; }
    .to { font-size:13px; line-height:1.6; margin-bottom:8px; }
    .meta { border-top:1px solid #ccc; padding-top:6px; display:flex; flex-direction:column; gap:2px; }
    .ref { font-weight:bold; }
    .sku { color:#555; }
    .tracking { font-family:monospace; font-size:10px; }
    @media print { body { margin:0; } }
  </style></head><body>${labels.join('')}</body></html>`;
}

function buildInvoicesHtml(orders: Order[]): string {
  const pages = orders.map((o) => `
    <div class="invoice">
      <div class="header">
        <div class="title">INVOICE / PACKING SLIP</div>
        <div class="ref">Order #${o.salesRecordNumber}</div>
      </div>
      <div class="section">
        <div class="col">
          <p class="label">Ship To</p>
          <p><strong>${o.postToName}</strong></p>
          <p>${o.postToAddress1}</p>
          ${o.postToAddress2 ? `<p>${o.postToAddress2}</p>` : ''}
          <p>${o.postToCity}${o.postToCounty ? ', ' + o.postToCounty : ''}</p>
          <p>${o.postToPostcode}</p>
          ${o.postToCountry && o.postToCountry !== 'United Kingdom' ? `<p>${o.postToCountry}</p>` : ''}
        </div>
        <div class="col">
          <p class="label">Order Details</p>
          <p>Sale Date: ${o.saleDate || o.paidOnDate || '—'}</p>
          <p>Source: ${o.batchId.includes('batch') ? 'eBay' : 'BackMarket'}</p>
          ${o.customLabel ? `<p>SKU: ${o.customLabel}</p>` : ''}
          ${o.trackingNumber ? `<p>Tracking: ${o.trackingNumber}</p>` : ''}
        </div>
      </div>
      <table>
        <thead><tr><th>Item</th><th>Variation</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
        <tbody>
          <tr>
            <td>${o.itemTitle}</td>
            <td>${o.variation || '—'}</td>
            <td>${o.quantity}</td>
            <td>£${o.soldFor.toFixed(2)}</td>
            <td>£${(o.soldFor * o.quantity).toFixed(2)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr><td colspan="3"></td><td>Postage</td><td>£${o.postageAndPackaging.toFixed(2)}</td></tr>
          <tr class="total"><td colspan="3"></td><td>Total</td><td>£${o.totalPrice.toFixed(2)}</td></tr>
        </tfoot>
      </table>
      ${o.buyerNote ? `<div class="note"><strong>Buyer Note:</strong> ${o.buyerNote}</div>` : ''}
    </div>`);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Invoices</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; font-size: 11px; color:#111; }
    .invoice { padding:20px; max-width:18cm; margin:0 auto; page-break-after:always; }
    .invoice:last-child { page-break-after:auto; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #111; padding-bottom:10px; margin-bottom:14px; }
    .title { font-size:18px; font-weight:bold; }
    .ref { font-size:13px; color:#555; }
    .section { display:flex; gap:30px; margin-bottom:16px; }
    .col { flex:1; }
    .col p { line-height:1.6; }
    p.label { font-weight:bold; text-transform:uppercase; font-size:9px; color:#888; margin-bottom:4px; }
    table { width:100%; border-collapse:collapse; margin-bottom:12px; }
    th, td { border:1px solid #ccc; padding:5px 7px; text-align:left; font-size:11px; }
    th { background:#f0f0f0; font-weight:bold; }
    tfoot td { border-top:1px solid #999; }
    tr.total td { font-weight:bold; }
    .note { background:#fffbe6; border:1px solid #f0c040; padding:8px; border-radius:4px; font-size:11px; }
    @media print { body { margin:0; } }
  </style></head><body>${pages.join('')}</body></html>`;
}

function downloadLabelsCSV(orders: Order[]) {
  const rows = orders.flatMap((o) => {
    const qty = o.labelQty || 1;
    return Array.from({ length: qty }, () => ({
      'Order #': o.salesRecordNumber,
      'SKU': o.customLabel,
      'Item': o.itemTitle,
      'Name': o.postToName,
      'Address 1': o.postToAddress1,
      'Address 2': o.postToAddress2,
      'City': o.postToCity,
      'County': o.postToCounty,
      'Postcode': o.postToPostcode,
      'Country': o.postToCountry,
      'Phone': o.postToPhone,
      'Carrier': o.deliveryCarrier,
      'Service': o.deliveryType,
      'Tracking': o.trackingNumber,
    }));
  });
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `labels-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CSVImport() {
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<{
    orders: Order[];
    format: string;
    fileName: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addOrders = useOrderStore((s) => s.addOrders);

  function setLabelQty(index: number, qty: number) {
    if (!preview) return;
    const updated = preview.orders.map((o, i) => i === index ? { ...o, labelQty: Math.max(1, qty) } : o);
    setPreview({ ...preview, orders: updated });
  }

  function setAllLabelQty(qty: number) {
    if (!preview) return;
    const updated = preview.orders.map((o) => ({ ...o, labelQty: Math.max(1, qty) }));
    setPreview({ ...preview, orders: updated });
  }

  function processFile(file: File) {
    const reader = new FileReader();
    reader.onerror = () => {
      toast.error('Failed to read file');
    };
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content || content.trim().length === 0) {
        toast.error('File appears to be empty');
        return;
      }
      const batchId = `batch-${Date.now()}`;
      try {
        const { orders, format } = parseCSV(content, batchId);
        if (orders.length === 0) {
          toast.error('No orders found in file. Check the format.');
          return;
        }
        setPreview({ orders, format, fileName: file.name });
        toast.success(`Parsed ${orders.length} orders from ${format.toUpperCase()} export`);
      } catch (err) {
        toast.error(`Failed to parse CSV: ${err instanceof Error ? err.message : 'Unknown error'}`);
        console.error(err);
      }
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      processFile(file);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    processFile(file);
  }

  const handleImport = () => {
    if (!preview) return;
    setImporting(true);

    const batch: Batch = {
      id: preview.orders[0]?.batchId || `batch-${Date.now()}`,
      name: preview.fileName,
      importedAt: new Date().toISOString(),
      orderCount: preview.orders.length,
      source: preview.format as 'ebay' | 'backmarket',
    };

    addOrders(preview.orders, batch);
    toast.success(`Imported ${preview.orders.length} orders successfully!`);
    setPreview(null);
    setImporting(false);
  };

  const globalLabelQty = preview
    ? (preview.orders.every((o) => o.labelQty === preview.orders[0].labelQty)
        ? preview.orders[0].labelQty
        : null)
    : 1;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Import Orders</h2>
        <p className="text-slate-500 text-sm mt-1">
          Upload your eBay or BackMarket CSV export file
        </p>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt,.tsv"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-xl transition-colors cursor-pointer p-16 flex flex-col items-center justify-center ${
          dragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-slate-300 hover:border-slate-400 bg-white'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(true);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
        }}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload
          className={`h-12 w-12 mb-4 ${
            dragActive ? 'text-blue-500' : 'text-slate-400'
          }`}
        />
        <h3 className="text-lg font-medium text-slate-700">
          Drop your CSV file here
        </h3>
        <p className="text-sm text-slate-500 mt-1 mb-4">
          Supports eBay Seller Hub export and BackMarket export formats
        </p>
        <Button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
        >
          <FileText className="h-4 w-4 mr-2" />
          Browse Files
        </Button>
      </div>

      {/* Preview */}
      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Preview: {preview.fileName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="p-3 bg-slate-100 rounded-lg">
                <p className="text-slate-500">Format</p>
                <p className="font-bold">{preview.format.toUpperCase()}</p>
              </div>
              <div className="p-3 bg-slate-100 rounded-lg">
                <p className="text-slate-500">Orders Found</p>
                <p className="font-bold">{preview.orders.length}</p>
              </div>
              <div className="p-3 bg-slate-100 rounded-lg">
                <p className="text-slate-500">Total Value</p>
                <p className="font-bold">
                  £
                  {preview.orders
                    .reduce((s, o) => s + o.soldFor, 0)
                    .toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Print / export actions */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => printHtml(buildLabelsHtml(preview.orders))}
              >
                <Printer className="h-4 w-4" />
                Print Labels
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => printHtml(buildInvoicesHtml(preview.orders))}
              >
                <Printer className="h-4 w-4" />
                Print Invoices
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => { downloadLabelsCSV(preview.orders); toast.success('Labels CSV downloaded'); }}
              >
                <Download className="h-4 w-4" />
                Download Labels CSV
              </Button>
            </div>

            {/* Global label qty setter */}
            <div className="flex items-center gap-3 p-3 bg-slate-50 border rounded-lg">
              <Tag className="h-4 w-4 text-slate-500 shrink-0" />
              <span className="text-sm text-slate-600 font-medium">Set label qty for all orders:</span>
              <input
                type="number"
                min={1}
                max={10}
                value={globalLabelQty ?? ''}
                placeholder="mixed"
                onChange={(e) => setAllLabelQty(Number(e.target.value))}
                className="w-16 h-7 border rounded px-2 text-sm text-center"
              />
            </div>

            {/* Sample of orders */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2 text-left">Order ID</th>
                    <th className="p-2 text-left">Customer</th>
                    <th className="p-2 text-left">Item</th>
                    <th className="p-2 text-left">Amount</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-center">Label Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.orders.slice(0, 15).map((order, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 font-mono">
                        {order.salesRecordNumber}
                      </td>
                      <td className="p-2">{order.postToName}</td>
                      <td className="p-2 max-w-[180px] truncate">
                        {order.itemTitle}
                      </td>
                      <td className="p-2">£{order.soldFor.toFixed(2)}</td>
                      <td className="p-2">
                        <span className="px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 text-xs">
                          {order.status}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={order.labelQty ?? 1}
                          onChange={(e) => setLabelQty(i, Number(e.target.value))}
                          className="w-12 h-6 border rounded px-1 text-xs text-center"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.orders.length > 15 && (
                <div className="p-2 text-center text-xs text-slate-500 bg-slate-50">
                  ... and {preview.orders.length - 15} more orders
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button onClick={handleImport} disabled={importing}>
                {importing ? 'Importing...' : `Import ${preview.orders.length} Orders`}
              </Button>
              <Button variant="outline" onClick={() => setPreview(null)}>
                Cancel
              </Button>
            </div>

            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">
                Orders with existing tracking numbers will be marked as
                &quot;Shipped&quot;. All others default to &quot;Pending&quot;.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
