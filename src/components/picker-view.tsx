'use client';

import { useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { Department, DEPARTMENT_CONFIG } from '@/lib/types';
import { suggestBuildLines } from '@/lib/inventory-build';
import { Button } from '@/components/ui/button';
import { ListChecks, Check, Undo2, Tag } from 'lucide-react';
import { toast } from 'sonner';

// Categories a set of departments may pick; null = all (open dept like management).
function catsForDepts(depts: Department[]): string[] | null {
  const out: string[] = [];
  for (const d of depts) {
    const c = DEPARTMENT_CONFIG[d];
    if (!c) continue;
    if (!c.categories) return null;
    out.push(...c.categories);
  }
  return out.length ? out : null;
}

export function PickerView() {
  const orders = useOrderStore((s) => s.orders);
  const parts = useOrderStore((s) => s.inventoryParts);
  const stockUnits = useOrderStore((s) => s.stockUnits);
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const setOrderPicked = useOrderStore((s) => s.setOrderPicked);

  const currentUser = users.find((u) => u.id === currentUserId);
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'manager';
  const depts: Department[] = currentUser
    ? (currentUser.departments?.length ? currentUser.departments : [currentUser.department ?? 'management'])
    : [];
  const cats = isAdmin ? null : catsForDepts(depts);

  // Per-order tick state — a local aid while gathering parts.
  const [ticked, setTicked] = useState<Record<string, Set<number>>>({});
  const toggle = (orderId: string, i: number) =>
    setTicked((prev) => {
      const set = new Set(prev[orderId] ?? []);
      if (set.has(i)) set.delete(i); else set.add(i);
      return { ...prev, [orderId]: set };
    });

  const visible = useMemo(() =>
    orders
      .filter((o) => !o.deletedAt && o.status === 'pending' && (o.postToAddress1 || o.postToPostcode) && (!cats || o.isGSP || cats.includes(o.category)))
      .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5) || (a.postByDate || a.saleDate).localeCompare(b.postByDate || b.saleDate)),
    [orders, cats]
  );
  const toPick = visible.filter((o) => !o.pickedAt);
  const picked = visible.filter((o) => o.pickedAt);

  function submit(orderId: string) {
    setOrderPicked(orderId, true);
    setTicked((prev) => { const n = { ...prev }; delete n[orderId]; return n; });
    toast.success('Parts picked — ready for assembly', { icon: '✅' });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><ListChecks className="h-6 w-6 text-lime-600" /> Order Picker</h2>
        <p className="text-slate-500 text-sm mt-1">Gather the parts for each pending order, then submit so it&apos;s ready for assembly.</p>
      </div>

      {/* To pick */}
      <div>
        <h3 className="text-sm font-semibold text-slate-600 mb-2">To pick · {toPick.length}</h3>
        {toPick.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center border border-dashed rounded-xl">Nothing to pick right now.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {toPick.map((order) => {
              const lines = suggestBuildLines(order, parts, stockUnits);
              const set = ticked[order.id] ?? new Set<number>();
              return (
                <div key={order.id} className="border border-slate-200 rounded-xl bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-mono text-slate-400">#{order.salesRecordNumber} · P{order.priority ?? 5}</p>
                      <p className="text-sm font-medium text-slate-800 leading-snug">{order.itemTitle}</p>
                    </div>
                    <span className="text-sm font-semibold text-slate-700 shrink-0">£{order.soldFor.toFixed(2)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    {order.customLabel && <span className="font-mono flex items-center gap-1"><Tag className="h-3 w-3" /> {order.customLabel}</span>}
                    <span>Qty {order.quantity}</span>
                  </div>
                  {order.variation && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 font-medium">{order.variation}</p>
                  )}

                  {/* Parts checklist */}
                  <div className="mt-3 space-y-1">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Parts to pick</p>
                    {lines.length === 0 ? (
                      <p className="text-xs text-slate-400">No specific parts suggested — pick per the title/variation.</p>
                    ) : lines.map((l, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={set.has(i)} onChange={() => toggle(order.id, i)} className="h-4 w-4 accent-lime-600" />
                        <span className={set.has(i) ? 'line-through text-slate-400' : 'text-slate-700'}>
                          {l.description || l.category}{l.quantity > 1 ? ` ×${l.quantity}` : ''}
                        </span>
                      </label>
                    ))}
                  </div>

                  <Button onClick={() => submit(order.id)} className="w-full mt-3 bg-lime-600 hover:bg-lime-700 text-white">
                    <Check className="h-4 w-4 mr-1.5" /> Submit — picked
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Picked */}
      {picked.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-600 mb-2">Picked · {picked.length}</h3>
          <div className="space-y-1.5">
            {picked.map((order) => (
              <div key={order.id} className="flex items-center gap-2 text-sm bg-lime-50 border border-lime-200 rounded-lg px-3 py-2">
                <Check className="h-4 w-4 text-lime-600 shrink-0" />
                <span className="font-mono text-xs text-slate-400 shrink-0">#{order.salesRecordNumber}</span>
                <span className="truncate flex-1 text-slate-700">{order.itemTitle}</span>
                {order.pickedByName && <span className="text-xs text-slate-400 shrink-0">{order.pickedByName}</span>}
                <button onClick={() => setOrderPicked(order.id, false)} className="text-slate-400 hover:text-slate-700 shrink-0" title="Undo">
                  <Undo2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
