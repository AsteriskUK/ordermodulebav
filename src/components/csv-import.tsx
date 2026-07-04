'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Printer, Download, Tag, RefreshCw, Wifi, WifiOff, Sparkles, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseCSV } from '@/lib/csv-parser';
import { buildInvoicesHtml as buildInvoicesHtmlUtil, printHtml as printHtmlUtil } from '@/lib/order-utils';
import { useOrderStore } from '@/lib/store';
import { Batch, Order } from '@/lib/types';
import { OrderSourceLogo } from '@/components/order-source-logo';
import { toast } from 'sonner';
import Papa from 'papaparse';

// Generate proper UUID v4 for PostgreSQL compatibility
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

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
          <p>Source: ${o.batchId}</p>
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
    format: 'ebay' | 'backmarket' | 'amazon' | 'temu' | 'onbuy';
    fileName: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // eBay direct import state
  const [ebayConnected, setEbayConnected] = useState<boolean | null>(null);
  const [ebayEnvToken, setEbayEnvToken] = useState(false);
  const [ebayFetching, setEbayFetching] = useState(false);
  const [ebayDays, setEbayDays] = useState(7);

  // Backmarket direct import state
  const [backmarketConnected, setBackmarketConnected] = useState<boolean | null>(null);
  const [backmarketFetching, setBackmarketFetching] = useState(false);
  const [backmarketDays, setBackmarketDays] = useState(7);

  // Temu direct import state
  const [temuConnected, setTemuConnected] = useState<boolean | null>(null);
  const [temuFetching, setTemuFetching] = useState(false);
  const [temuDays, setTemuDays] = useState(7);

  // OnBuy direct import state
  const [onbuyConnected, setOnbuyConnected] = useState<boolean | null>(null);
  const [onbuyFetching, setOnbuyFetching] = useState(false);
  const [onbuyDays, setOnbuyDays] = useState(7);

  const addOrders = useOrderStore((s) => s.addOrders);
  const updateOrderCategory = useOrderStore((s) => s.updateOrderCategory);
  const [aiCategorising, setAiCategorising] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('ebay_connected') === '1') {
      setEbayConnected(true);
      toast.success('eBay account connected successfully!');
      window.history.replaceState({}, '', '/import');
    } else if (params.get('ebay_error')) {
      toast.error(`eBay connection failed: ${params.get('ebay_error')}`);
      window.history.replaceState({}, '', '/import');
      checkEbayStatus();
    } else {
      checkEbayStatus();
    }
    checkBackmarketStatus();
    checkTemuStatus();
    checkOnbuyStatus();
  }, []);

  async function checkBackmarketStatus() {
    try {
      const res = await fetch('/api/backmarket/status');
      if (res.ok) {
        const data = await res.json() as { connected: boolean };
        setBackmarketConnected(data.connected);
      } else {
        setBackmarketConnected(false);
      }
    } catch {
      setBackmarketConnected(false);
    }
  }

  async function handleBackmarketImport() {
    setBackmarketFetching(true);
    try {
      const res = await fetch(`/api/backmarket/orders?days=${backmarketDays}`);
      if (res.status === 401) {
        setBackmarketConnected(false);
        toast.error('Backmarket credentials not configured.');
        return;
      }
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        toast.error(`Backmarket API error: ${err.message || res.statusText}`);
        return;
      }
      const data = await res.json() as { orders: Order[]; batch: Batch };
      if (data.orders.length === 0) {
        toast.info('No orders found in Backmarket for this period.');
        return;
      }
      setPreview({ orders: data.orders, format: 'backmarket', fileName: data.batch.name });
      toast.success(`Fetched ${data.orders.length} orders from Backmarket`);
    } catch (e) {
      toast.error(`Failed to fetch Backmarket orders: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setBackmarketFetching(false);
    }
  }

  async function checkTemuStatus() {
    try {
      const res = await fetch('/api/temu/status');
      if (res.ok) {
        const data = await res.json() as { connected: boolean };
        setTemuConnected(data.connected);
      } else {
        setTemuConnected(false);
      }
    } catch {
      setTemuConnected(false);
    }
  }

  async function handleTemuImport() {
    setTemuFetching(true);
    try {
      const res = await fetch(`/api/temu/orders?days=${temuDays}`);
      if (res.status === 401) {
        setTemuConnected(false);
        toast.error('Temu credentials not configured. Set TEMU_APP_KEY, TEMU_APP_SECRET, and TEMU_ACCESS_TOKEN.');
        return;
      }
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        toast.error(`Temu API error: ${err.message || res.statusText}`);
        return;
      }
      const data = await res.json() as { orders: Order[]; batch: Batch };
      if (data.orders.length === 0) {
        toast.info('No orders found in Temu for this period.');
        return;
      }
      setPreview({ orders: data.orders, format: 'temu', fileName: data.batch.name });
      toast.success(`Fetched ${data.orders.length} orders from Temu`);
    } catch (e) {
      toast.error(`Failed to fetch Temu orders: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setTemuFetching(false);
    }
  }

  async function checkOnbuyStatus() {
    try {
      const res = await fetch('/api/onbuy/status');
      if (res.ok) {
        const data = await res.json() as { connected: boolean };
        setOnbuyConnected(data.connected);
      } else {
        setOnbuyConnected(false);
      }
    } catch {
      setOnbuyConnected(false);
    }
  }

  async function handleOnbuyImport() {
    setOnbuyFetching(true);
    try {
      const res = await fetch(`/api/onbuy/orders?days=${onbuyDays}`);
      if (res.status === 401) {
        setOnbuyConnected(false);
        toast.error('OnBuy credentials not configured. Set ONBUY_CONSUMER_KEY and ONBUY_SECRET_KEY.');
        return;
      }
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        toast.error(`OnBuy API error: ${err.message || res.statusText}`);
        return;
      }
      const data = await res.json() as { orders: Order[]; batch: Batch };
      if (data.orders.length === 0) {
        toast.info('No orders found in OnBuy for this period.');
        return;
      }
      setPreview({ orders: data.orders, format: 'onbuy', fileName: data.batch.name });
      toast.success(`Fetched ${data.orders.length} orders from OnBuy`);
    } catch (e) {
      toast.error(`Failed to fetch OnBuy orders: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setOnbuyFetching(false);
    }
  }

  async function checkEbayStatus() {
    try {
      const res = await fetch('/api/ebay/status');
      if (res.ok) {
        const data = await res.json() as { connected: boolean; source: string };
        setEbayConnected(data.connected);
        setEbayEnvToken(data.source === 'env');
      } else {
        setEbayConnected(false);
      }
    } catch {
      setEbayConnected(false);
    }
  }

  async function handleEbayImport() {
    setEbayFetching(true);
    try {
      const res = await fetch(`/api/ebay/orders?days=${ebayDays}`);
      if (res.status === 401) {
        setEbayConnected(false);
        toast.error('eBay session expired. Please reconnect.');
        return;
      }
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        toast.error(`eBay API error: ${err.message || res.statusText}`);
        return;
      }
      const data = await res.json() as { orders: Order[]; batch: Batch };
      if (data.orders.length === 0) {
        toast.info('No unfulfilled orders found in eBay for this period.');
        return;
      }
      setPreview({ orders: data.orders, format: 'ebay', fileName: data.batch.name });
      toast.success(`Fetched ${data.orders.length} orders from eBay`);
    } catch (e) {
      toast.error(`Failed to fetch eBay orders: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setEbayFetching(false);
    }
  }

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
      const batchId = generateUUID();
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

  const handleImport = async () => {
    if (!preview) return;
    setImporting(true);

    const batch: Batch = {
      id: preview.orders[0]?.batchId || generateUUID(),
      name: preview.fileName,
      importedAt: new Date().toISOString(),
      orderCount: preview.orders.length,
      source: preview.format as Batch['source'],
    };

    const importedOrders = preview.orders;
    addOrders(importedOrders, batch);
    toast.success(`Imported ${importedOrders.length} orders successfully!`);
    printHtmlUtil(buildInvoicesHtmlUtil(importedOrders));
    setPreview(null);
    setImporting(false);

    // Background AI categorisation for N/A items
    const uncategorised = preview.orders
      .filter((o) => o.category === 'N/A' && o.itemTitle)
      .map((o) => ({ id: o.id, title: o.itemTitle }));

    if (uncategorised.length > 0) {
      setAiCategorising(true);
      try {
        const res = await fetch('/api/ai/categorise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: uncategorised }),
        });
        if (res.ok) {
          const data = await res.json();
          let updated = 0;
          for (const r of data.results ?? []) {
            if (r.category && r.category !== 'N/A') {
              updateOrderCategory(r.id, r.category);
              updated++;
            }
          }
          if (updated > 0) toast.success(`AI classified ${updated} uncategorised item${updated !== 1 ? 's' : ''}`, { icon: '✨' });
        }
      } catch {
        // Silent fail — categorisation is best-effort
      } finally {
        setAiCategorising(false);
      }
    }
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

      {/* eBay Direct Import */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="pt-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <OrderSourceLogo source="ebay" className="h-6 w-6" />
              <div>
                <p className="font-semibold text-slate-800">Import from eBay</p>
                <p className="text-xs text-slate-500">Fetch unfulfilled orders directly via eBay API</p>
              </div>
              {ebayConnected === true && (
                <span className="flex items-center gap-1 text-xs text-green-700 bg-green-100 border border-green-300 rounded-full px-2 py-0.5">
                  <Wifi className="h-3 w-3" /> Connected
                </span>
              )}
              {ebayConnected === false && (
                <span className="flex items-center gap-1 text-xs text-red-700 bg-red-100 border border-red-300 rounded-full px-2 py-0.5">
                  <WifiOff className="h-3 w-3" /> Not connected
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600">Last</label>
              <select
                value={ebayDays}
                onChange={(e) => setEbayDays(Number(e.target.value))}
                className="h-8 border rounded px-2 text-xs bg-white"
              >
                {[1, 3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
              {ebayConnected ? (
                <Button
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={handleEbayImport}
                  disabled={ebayFetching}
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${ebayFetching ? 'animate-spin' : ''}`} />
                  {ebayFetching ? 'Fetching...' : 'Fetch Orders'}
                </Button>
              ) : (
                !ebayEnvToken && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-400 text-amber-700 hover:bg-amber-100"
                    onClick={() => { window.location.href = '/api/ebay/auth'; }}
                  >
                    Connect eBay Account
                  </Button>
                )
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Backmarket Direct Import */}
      <Card className="border-indigo-200 bg-indigo-50">
        <CardContent className="pt-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <OrderSourceLogo source="backmarket" className="h-6 w-6" />
              <div>
                <p className="font-semibold text-slate-800">Import from Backmarket</p>
                <p className="text-xs text-slate-500">Fetch paid orders directly via Backmarket API</p>
              </div>
              {backmarketConnected === true && (
                <span className="flex items-center gap-1 text-xs text-green-700 bg-green-100 border border-green-300 rounded-full px-2 py-0.5">
                  <Wifi className="h-3 w-3" /> Connected
                </span>
              )}
              {backmarketConnected === false && (
                <span className="flex items-center gap-1 text-xs text-red-700 bg-red-100 border border-red-300 rounded-full px-2 py-0.5">
                  <WifiOff className="h-3 w-3" /> Not configured
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600">Last</label>
              <select
                value={backmarketDays}
                onChange={(e) => setBackmarketDays(Number(e.target.value))}
                className="h-8 border rounded px-2 text-xs bg-white"
              >
                {[1, 3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
              <Button
                size="sm"
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={handleBackmarketImport}
                disabled={backmarketFetching}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${backmarketFetching ? 'animate-spin' : ''}`} />
                {backmarketFetching ? 'Fetching...' : 'Fetch Orders'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Temu Direct Import */}
      <Card className="border-orange-200 bg-orange-50">
        <CardContent className="pt-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <OrderSourceLogo source="temu" className="h-6 w-6" />
              <div>
                <p className="font-semibold text-slate-800">Import from Temu</p>
                <p className="text-xs text-slate-500">Fetch orders directly via Temu Open Platform API</p>
              </div>
              {temuConnected === true && (
                <span className="flex items-center gap-1 text-xs text-green-700 bg-green-100 border border-green-300 rounded-full px-2 py-0.5">
                  <Wifi className="h-3 w-3" /> Connected
                </span>
              )}
              {temuConnected === false && (
                <span className="flex items-center gap-1 text-xs text-red-700 bg-red-100 border border-red-300 rounded-full px-2 py-0.5">
                  <WifiOff className="h-3 w-3" /> Not configured
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600">Last</label>
              <select
                value={temuDays}
                onChange={(e) => setTemuDays(Number(e.target.value))}
                className="h-8 border rounded px-2 text-xs bg-white"
              >
                {[1, 3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
              <Button
                size="sm"
                className="bg-orange-600 hover:bg-orange-700 text-white"
                onClick={handleTemuImport}
                disabled={temuFetching || !temuConnected}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${temuFetching ? 'animate-spin' : ''}`} />
                {temuFetching ? 'Fetching...' : 'Fetch Orders'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* OnBuy Direct Import */}
      <Card className="border-teal-200 bg-teal-50">
        <CardContent className="pt-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <OrderSourceLogo source="onbuy" className="h-6 w-6" />
              <div>
                <p className="font-semibold text-slate-800">Import from OnBuy</p>
                <p className="text-xs text-slate-500">Fetch orders directly via the OnBuy v2 API</p>
              </div>
              {onbuyConnected === true && (
                <span className="flex items-center gap-1 text-xs text-green-700 bg-green-100 border border-green-300 rounded-full px-2 py-0.5">
                  <Wifi className="h-3 w-3" /> Connected
                </span>
              )}
              {onbuyConnected === false && (
                <span className="flex items-center gap-1 text-xs text-red-700 bg-red-100 border border-red-300 rounded-full px-2 py-0.5">
                  <WifiOff className="h-3 w-3" /> Not configured
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600">Last</label>
              <select
                value={onbuyDays}
                onChange={(e) => setOnbuyDays(Number(e.target.value))}
                className="h-8 border rounded px-2 text-xs bg-white"
              >
                {[1, 3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
              <Button
                size="sm"
                className="bg-teal-600 hover:bg-teal-700 text-white"
                onClick={handleOnbuyImport}
                disabled={onbuyFetching || !onbuyConnected}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${onbuyFetching ? 'animate-spin' : ''}`} />
                {onbuyFetching ? 'Fetching...' : 'Fetch Orders'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
                    <th className="p-2 text-left">Amazon Order ID</th>
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
                        {order.amazonOrderId || order.salesRecordNumber}
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

            <div className="flex gap-3 items-center flex-wrap">
              <Button onClick={handleImport} disabled={importing}>
                {importing ? 'Importing...' : `Import ${preview.orders.length} Orders`}
              </Button>
              <Button variant="outline" onClick={() => setPreview(null)}>
                Cancel
              </Button>
              {aiCategorising && (
                <span className="flex items-center gap-1.5 text-xs text-purple-600 animate-pulse">
                  <Sparkles className="h-3.5 w-3.5" />
                  AI classifying uncategorised items…
                </span>
              )}
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
