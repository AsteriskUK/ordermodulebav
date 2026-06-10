'use client';

import { useOrderStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Package, Trash2, Calendar } from 'lucide-react';
import { toast } from 'sonner';

export function BatchList() {
  const batches = useOrderStore((s) => s.batches);
  const orders = useOrderStore((s) => s.orders);
  const deleteBatch = useOrderStore((s) => s.deleteBatch);

  const handleDelete = (batchId: string, batchName: string) => {
    if (confirm(`Delete batch "${batchName}" and all its orders?`)) {
      deleteBatch(batchId);
      toast.success(`Deleted batch: ${batchName}`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Import Batches</h2>
        <p className="text-slate-500 text-sm mt-1">
          View and manage all imported CSV batches
        </p>
      </div>

      {batches.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-slate-300 mb-4" />
            <h3 className="text-lg font-medium text-slate-600">
              No batches imported
            </h3>
            <p className="text-sm text-slate-400 mt-1">
              Import a CSV file to create your first batch
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {batches
            .slice()
            .reverse()
            .map((batch) => {
              const batchOrders = orders.filter((o) => o.batchId === batch.id);
              const pending = batchOrders.filter(
                (o) => o.status === 'pending'
              ).length;
              const packed = batchOrders.filter(
                (o) => o.status === 'packed'
              ).length;
              const shipped = batchOrders.filter(
                (o) => o.status === 'shipped'
              ).length;

              return (
                <Card key={batch.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Package className="h-4 w-4 text-blue-500" />
                        {batch.name}
                      </CardTitle>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleDelete(batch.id, batch.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(batch.importedAt).toLocaleString('en-GB')}
                      </div>
                      <span className="text-slate-300">|</span>
                      <span className="font-medium">
                        {batch.orderCount} orders
                      </span>
                      <span className="text-slate-300">|</span>
                      <span className="uppercase text-xs font-bold text-slate-400">
                        {batch.source}
                      </span>
                    </div>
                    <div className="flex gap-4 mt-3 text-xs">
                      <span className="px-2 py-1 bg-yellow-50 text-yellow-700 rounded">
                        {pending} pending
                      </span>
                      <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded">
                        {packed} packed
                      </span>
                      <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded">
                        {shipped} shipped
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}
    </div>
  );
}
