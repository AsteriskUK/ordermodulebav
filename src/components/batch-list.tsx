'use client';

import { useState, useRef } from 'react';
import { useOrderStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Package, Trash2, Calendar, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Batch } from '@/lib/types';

function DeleteButton({
  batch,
  onConfirmed,
}: {
  batch: Batch;
  onConfirmed: () => void;
}) {
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const currentUser = users.find((u) => u.id === currentUserId);

  const canDelete = currentUser?.role === 'admin' || currentUser?.role === 'manager';

  // 'idle' | 'pin' | 'confirm'
  const [mode, setMode] = useState<'idle' | 'pin' | 'confirm'>('idle');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = () => { setMode('idle'); setPin(''); setPinError(false); };

  const handleTrashClick = () => {
    if (!canDelete) {
      toast.error('Only admins or managers can delete batches');
      return;
    }
    setPin('');
    setPinError(false);
    // If user has no PIN, skip straight to confirm
    setMode(currentUser?.pin ? 'pin' : 'confirm');
  };

  const verifyPin = () => {
    if (pin === currentUser?.pin) {
      setPinError(false);
      setMode('confirm');
      setPin('');
    } else {
      setPinError(true);
      setPin('');
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setPinError(false), 1500);
    }
  };

  const handlePinKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { reset(); return; }
    if (e.key === 'Enter') verifyPin();
  };

  if (mode === 'pin') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500 mr-1">PIN to delete:</span>
        <Input
          autoFocus
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => { setPin(e.target.value); setPinError(false); }}
          onKeyDown={handlePinKey}
          placeholder="••••"
          className={`h-7 w-[64px] text-xs font-mono text-center tracking-widest ${pinError ? 'border-red-400 bg-red-50' : ''}`}
        />
        <button onClick={verifyPin} className="p-1 text-blue-600 hover:text-blue-800" title="Confirm PIN">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button onClick={reset} className="p-1 text-slate-400 hover:text-slate-600" title="Cancel">
          <X className="h-3.5 w-3.5" />
        </button>
        {pinError && <span className="text-[10px] text-red-500">Incorrect PIN</span>}
      </div>
    );
  }

  if (mode === 'confirm') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-red-600 font-medium">Delete &ldquo;{batch.name}&rdquo;?</span>
        <button
          onClick={() => { onConfirmed(); reset(); }}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
        >
          <Trash2 className="h-3 w-3" /> Yes, delete
        </button>
        <button onClick={reset} className="p-1 text-slate-400 hover:text-slate-600" title="Cancel">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (!canDelete) return null;

  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-red-400 hover:text-red-600 hover:bg-red-50"
      onClick={handleTrashClick}
      title="Delete batch (PIN required)"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

export function BatchList() {
  const batches = useOrderStore((s) => s.batches);
  const orders = useOrderStore((s) => s.orders);
  const deleteBatch = useOrderStore((s) => s.deleteBatch);

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
            <h3 className="text-lg font-medium text-slate-600">No batches imported</h3>
            <p className="text-sm text-slate-400 mt-1">Import a CSV file to create your first batch</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {batches
            .slice()
            .reverse()
            .map((batch) => {
              const batchOrders = orders.filter((o) => o.batchId === batch.id);
              const pending = batchOrders.filter((o) => o.status === 'pending').length;
              const packed  = batchOrders.filter((o) => o.status === 'packed').length;
              const shipped = batchOrders.filter((o) => o.status === 'shipped').length;

              return (
                <Card key={batch.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Package className="h-4 w-4 text-blue-500" />
                        {batch.name}
                      </CardTitle>
                      <DeleteButton
                        batch={batch}
                        onConfirmed={() => {
                          deleteBatch(batch.id);
                          toast.success(`Deleted batch: ${batch.name}`);
                        }}
                      />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(batch.importedAt).toLocaleString('en-GB')}
                      </div>
                      <span className="text-slate-300">|</span>
                      <span className="font-medium">{batch.orderCount} orders</span>
                      <span className="text-slate-300">|</span>
                      <span className="uppercase text-xs font-bold text-slate-400">{batch.source}</span>
                    </div>
                    <div className="flex gap-4 mt-3 text-xs">
                      <span className="px-2 py-1 bg-yellow-50 text-yellow-700 rounded">{pending} pending</span>
                      <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded">{packed} packed</span>
                      <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded">{shipped} shipped</span>
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
