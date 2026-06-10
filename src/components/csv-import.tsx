'use client';

import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseCSV } from '@/lib/csv-parser';
import { useOrderStore } from '@/lib/store';
import { Batch } from '@/lib/types';
import { toast } from 'sonner';

export function CSVImport() {
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<{
    orders: ReturnType<typeof parseCSV>['orders'];
    format: string;
    fileName: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addOrders = useOrderStore((s) => s.addOrders);

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
                  </tr>
                </thead>
                <tbody>
                  {preview.orders.slice(0, 10).map((order, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 font-mono">
                        {order.salesRecordNumber}
                      </td>
                      <td className="p-2">{order.postToName}</td>
                      <td className="p-2 max-w-[200px] truncate">
                        {order.itemTitle}
                      </td>
                      <td className="p-2">£{order.soldFor.toFixed(2)}</td>
                      <td className="p-2">
                        <span className="px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 text-xs">
                          {order.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.orders.length > 10 && (
                <div className="p-2 text-center text-xs text-slate-500 bg-slate-50">
                  ... and {preview.orders.length - 10} more orders
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
