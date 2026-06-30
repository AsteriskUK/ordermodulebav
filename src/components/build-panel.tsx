'use client';

import { useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { Order, Build } from '@/lib/types';
import { INVENTORY_CATEGORIES, INVENTORY_CATEGORY_MAP, describeAttributes, BUILD_STATUS_CONFIG } from '@/lib/inventory-config';
import { computeAvailability } from '@/lib/inventory-utils';
import { suggestBuildLines, SuggestedLine } from '@/lib/inventory-build';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { X, Plus, Trash2, Wrench, Sparkles, AlertTriangle } from 'lucide-react';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const fieldCls = 'px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export function BuildPanel({ order, onClose }: { order: Order; onClose: () => void }) {
  const parts = useOrderStore((s) => s.inventoryParts);
  const stockUnits = useOrderStore((s) => s.stockUnits);
  const stockLevels = useOrderStore((s) => s.stockLevels);
  const builds = useOrderStore((s) => s.builds);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));
  const saveBuild = useOrderStore((s) => s.saveBuild);
  const cancelBuild = useOrderStore((s) => s.cancelBuild);

  const existing = useMemo(
    () => builds.find((b) => b.orderId === order.id && b.status !== 'cancelled'),
    [builds, order.id]
  );

  const [lines, setLines] = useState<SuggestedLine[]>(() => {
    if (existing) return existing.lines;
    return suggestBuildLines(order, parts, stockUnits);
  });

  const readOnly = existing?.status === 'consumed';
  const isReserved = existing?.status === 'reserved';

  function setLine(i: number, patch: Partial<SuggestedLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addLine() {
    setLines((prev) => [...prev, { category: 'ram', partId: '', quantity: 1, description: '' }]);
  }
  function reSuggest() {
    setLines(suggestBuildLines(order, parts, stockUnits));
    toast.success('Parts re-populated from the order');
  }

  function partsInCategory(cat: string) {
    return parts.filter((p) => p.category === cat);
  }
  function availableUnits(partId: string) {
    return stockUnits.filter((u) => u.partId === partId && (u.status === 'in_stock' || u.status === 'in_build'));
  }

  function reserve() {
    const cleaned = lines.filter((l) => l.partId);
    if (cleaned.length === 0) { toast.error('Pick at least one part to reserve'); return; }
    const now = new Date().toISOString();
    const build: Build = {
      id: existing?.id ?? uuid(),
      orderId: order.id,
      status: 'reserved',
      lines: cleaned.map((l) => {
        const part = parts.find((p) => p.id === l.partId);
        return { ...l, category: part?.category ?? l.category, description: part ? describeAttributes(part.category, part.attributes) || part.name : l.description };
      }),
      createdById: existing?.createdById ?? currentUser?.id,
      createdByName: existing?.createdByName ?? currentUser?.name,
      reservedAt: existing?.reservedAt ?? now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    saveBuild(build);
    toast.success('Parts reserved — on hold until packed');
    onClose();
  }

  function release() {
    if (existing) cancelBuild(existing.id);
    toast.success('Hold released');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 border-b">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Wrench className="h-5 w-5 text-blue-600" /> Build · #{order.salesRecordNumber}</h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate">{order.itemTitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {existing && <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${BUILD_STATUS_CONFIG[existing.status].color}`}>{BUILD_STATUS_CONFIG[existing.status].label}</span>}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {!readOnly && (
            <div className="flex justify-between items-center">
              <p className="text-xs text-slate-500">Parts needed for this order</p>
              <button onClick={reSuggest} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> Auto-populate</button>
            </div>
          )}

          {lines.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No parts yet — add the parts this build needs.</p>}

          {lines.map((line, i) => {
            const part = parts.find((p) => p.id === line.partId);
            const cat = INVENTORY_CATEGORY_MAP[line.category];
            const serialized = (part?.tracking ?? cat?.tracking) === 'serialized';
            const avail = part ? computeAvailability(part.id, part, stockLevels, stockUnits, builds) : null;
            return (
              <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={line.category}
                    disabled={readOnly}
                    onChange={(e) => setLine(i, { category: e.target.value, partId: '', stockUnitId: undefined })}
                    className={`${fieldCls} w-36`}
                  >
                    {INVENTORY_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <select
                    value={line.partId}
                    disabled={readOnly}
                    onChange={(e) => setLine(i, { partId: e.target.value, stockUnitId: undefined })}
                    className={`${fieldCls} flex-1 min-w-0`}
                  >
                    <option value="">— pick part —</option>
                    {partsInCategory(line.category).map((p) => <option key={p.id} value={p.id}>{describeAttributes(p.category, p.attributes) || p.name}</option>)}
                  </select>
                  {!readOnly && <button onClick={() => removeLine(i)} className="text-slate-400 hover:text-red-500 shrink-0"><Trash2 className="h-4 w-4" /></button>}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {serialized ? (
                    <select
                      value={line.stockUnitId ?? ''}
                      disabled={readOnly || !part}
                      onChange={(e) => setLine(i, { stockUnitId: e.target.value || undefined })}
                      className={`${fieldCls} flex-1 min-w-0`}
                    >
                      <option value="">— pick a unit —</option>
                      {part && availableUnits(part.id).map((u) => (
                        <option key={u.id} value={u.id}>{u.assetTag || u.id.slice(0, 8)}{u.grade ? ` · Grade ${u.grade}` : ''}{u.location ? ` · ${u.location}` : ''}</option>
                      ))}
                    </select>
                  ) : (
                    <label className="text-xs text-slate-500 flex items-center gap-1">
                      Qty
                      <input type="number" min={1} value={line.quantity} disabled={readOnly}
                        onChange={(e) => setLine(i, { quantity: Number(e.target.value) || 1 })} className={`${fieldCls} w-16`} />
                    </label>
                  )}
                  {avail && (
                    <span className={`text-xs ${avail.available < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                      {avail.available} available{avail.reserved ? ` · ${avail.reserved} on hold` : ''}
                    </span>
                  )}
                  {line.note && <span className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {line.note}</span>}
                </div>
              </div>
            );
          })}

          {!readOnly && <Button variant="outline" size="sm" onClick={addLine} className="w-full"><Plus className="h-4 w-4 mr-1" /> Add part</Button>}

          {isReserved && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              These parts are on hold. They’ll be deducted from stock automatically when the order reaches <strong>Packed</strong>.
            </p>
          )}
          {readOnly && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
              This build was deducted from stock when the order was packed.
            </p>
          )}
        </div>

        {!readOnly && (
          <div className="flex justify-between gap-2 p-5 border-t">
            {isReserved ? <Button variant="outline" onClick={release} className="text-red-600">Release hold</Button> : <span />}
            <Button onClick={reserve}>{isReserved ? 'Update reservation' : 'Reserve parts'}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
