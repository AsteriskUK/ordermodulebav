'use client';

import { useEffect, useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { Order, Build, BuildLine, CatalogProduct } from '@/lib/types';
import {
  INVENTORY_CATEGORIES, INVENTORY_CATEGORY_MAP, describeAttributes, buildSku,
  requiredSlotsForCategory, BUILD_STATUS_CONFIG,
} from '@/lib/inventory-config';
import { computeAvailability } from '@/lib/inventory-utils';
import { suggestBuildLines } from '@/lib/inventory-build';
import { fetchCatalogPage, catalogToAttributes, INVENTORY_TO_CATALOG_CATEGORY } from '@/lib/catalog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { X, Check, ChevronLeft, Plus, CircleAlert, Cpu, Boxes, ArrowRight, Minus, Library, Search, Loader2 } from 'lucide-react';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface Selection { partId: string; stockUnitId?: string; quantity: number; }

export function AssemblyBuilder({ order, onClose }: { order: Order; onClose: () => void }) {
  const parts = useOrderStore((s) => s.inventoryParts);
  const stockUnits = useOrderStore((s) => s.stockUnits);
  const stockLevels = useOrderStore((s) => s.stockLevels);
  const builds = useOrderStore((s) => s.builds);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));
  const saveBuild = useOrderStore((s) => s.saveBuild);
  const updateOrderStatus = useOrderStore((s) => s.updateOrderStatus);
  const upsertInventoryPart = useOrderStore((s) => s.upsertInventoryPart);

  const existing = useMemo(() => builds.find((b) => b.orderId === order.id && b.status !== 'cancelled'), [builds, order.id]);

  // Component slots for this product, plus any extra categories the assembler adds.
  const [slots, setSlots] = useState<string[]>(() => {
    const base = requiredSlotsForCategory(order.category);
    return base.length ? base : ['cpu', 'ram', 'storage'];
  });

  const [selections, setSelections] = useState<Record<string, Selection>>(() => {
    const init: Record<string, Selection> = {};
    const source = existing ? existing.lines : suggestBuildLines(order, parts, stockUnits);
    for (const l of source) {
      if (l.partId && !init[l.category]) init[l.category] = { partId: l.partId, stockUnitId: l.stockUnitId, quantity: l.quantity || 1 };
    }
    return init;
  });

  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const readOnly = existing?.status === 'consumed';

  const filledCount = slots.filter((s) => selections[s]?.partId).length;

  function pick(slot: string, sel: Selection) {
    setSelections((prev) => ({ ...prev, [slot]: sel }));
    setOpenSlot(null);
    setFilters({});
  }

  // Assembler picked a catalog product for a slot → materialize an inventory part
  // (linked to the catalog product) so the build/reserve/consume flow works as usual.
  function pickCatalog(slot: string, cp: CatalogProduct, quantity: number) {
    const cat = INVENTORY_CATEGORY_MAP[slot];
    let part = parts.find((p) => p.catalogProductId === cp.id);
    if (!part) {
      const now = new Date().toISOString();
      const attributes = catalogToAttributes(slot, cp);
      part = {
        id: uuid(), sku: buildSku(slot, attributes), category: slot,
        tracking: cat?.tracking ?? 'bulk', name: cp.name, attributes,
        imageUrl: cp.imageUrl, catalogProductId: cp.id, createdAt: now, updatedAt: now,
      };
      upsertInventoryPart(part);
      toast.success(`Added ${cp.name} to inventory`);
    }
    pick(slot, { partId: part.id, quantity: quantity || 1 });
  }
  function clearSlot(slot: string) {
    setSelections((prev) => { const n = { ...prev }; delete n[slot]; return n; });
  }
  function addSlot(cat: string) {
    if (!slots.includes(cat)) setSlots((prev) => [...prev, cat]);
    setOpenSlot(cat);
  }

  function complete(moveOn: boolean) {
    const lines: BuildLine[] = slots.filter((s) => selections[s]?.partId).map((s) => {
      const sel = selections[s];
      const part = parts.find((p) => p.id === sel.partId);
      return { category: part?.category ?? s, partId: sel.partId, stockUnitId: sel.stockUnitId, quantity: sel.quantity || 1, description: part ? describeAttributes(part.category, part.attributes) || part.name : s };
    });
    if (lines.length === 0) { toast.error('Select at least one part'); return; }
    const now = new Date().toISOString();
    const build: Build = {
      id: existing?.id ?? uuid(), orderId: order.id, status: 'reserved', lines,
      createdById: existing?.createdById ?? currentUser?.id, createdByName: existing?.createdByName ?? currentUser?.name,
      reservedAt: existing?.reservedAt ?? now, createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    saveBuild(build);
    if (moveOn) { updateOrderStatus(order.id, 'checking'); toast.success('Parts reserved — moved to Checking'); }
    else toast.success('Parts reserved (on hold until packed)');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-100 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-5 py-3 flex items-center gap-3 shrink-0">
        {openSlot ? (
          <button onClick={() => { setOpenSlot(null); setFilters({}); }} className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm">
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
        ) : (
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-900 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-blue-600" /> Assemble · #{order.salesRecordNumber}
            {existing && <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${BUILD_STATUS_CONFIG[existing.status].color}`}>{BUILD_STATUS_CONFIG[existing.status].label}</span>}
          </p>
          <p className="text-xs text-slate-400 truncate">{openSlot ? INVENTORY_CATEGORY_MAP[openSlot]?.label : order.itemTitle}</p>
        </div>
        {!openSlot && <span className="text-sm text-slate-500 shrink-0">{filledCount}/{slots.length} parts</span>}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5">
        {openSlot ? (
          <SlotPicker
            slot={openSlot}
            parts={parts} stockUnits={stockUnits} stockLevels={stockLevels} builds={builds}
            filters={filters} setFilters={setFilters}
            onPick={(sel) => pick(openSlot, sel)}
            onPickCatalog={(cp, qty) => pickCatalog(openSlot, cp, qty)}
          />
        ) : (
          <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {slots.map((slot) => {
              const cat = INVENTORY_CATEGORY_MAP[slot];
              const sel = selections[slot];
              const part = sel ? parts.find((p) => p.id === sel.partId) : undefined;
              const avail = part ? computeAvailability(part.id, part, stockLevels, stockUnits, builds) : null;
              return (
                <button key={slot} onClick={() => !readOnly && setOpenSlot(slot)}
                  className={`text-left rounded-xl border-2 p-4 bg-white transition-colors ${sel?.partId ? 'border-green-300' : 'border-dashed border-slate-300 hover:border-blue-400'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{cat?.label ?? slot}</span>
                    {sel?.partId ? <Check className="h-4 w-4 text-green-500" /> : <Plus className="h-4 w-4 text-slate-300" />}
                  </div>
                  {part ? (
                    <>
                      <p className="text-sm font-medium text-slate-800 mt-2 leading-snug">{describeAttributes(part.category, part.attributes) || part.name}</p>
                      <p className="text-xs mt-1 flex items-center gap-2">
                        {sel.stockUnitId ? <span className="text-slate-400 font-mono">{stockUnits.find((u) => u.id === sel.stockUnitId)?.assetTag ?? 'unit'}</span> : <span className="text-slate-400">Qty {sel.quantity}</span>}
                        {avail && <span className={avail.available < 0 ? 'text-red-600' : 'text-slate-400'}>· {avail.available} avail</span>}
                      </p>
                      {!readOnly && <span onClick={(e) => { e.stopPropagation(); clearSlot(slot); }} className="text-[11px] text-slate-400 hover:text-red-500 mt-1 inline-block">clear</span>}
                    </>
                  ) : (
                    <p className="text-sm text-slate-400 mt-2">Tap to pick from stock</p>
                  )}
                </button>
              );
            })}
            {!readOnly && (
              <AddSlotButton onAdd={addSlot} existing={slots} />
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {!openSlot && !readOnly && (
        <div className="bg-white border-t px-5 py-3 flex items-center justify-between gap-2 shrink-0">
          <Button variant="outline" onClick={() => complete(false)}>Save &amp; stay</Button>
          <Button onClick={() => complete(true)} className="bg-blue-600 hover:bg-blue-700 text-white">
            Complete assembly <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      )}
      {readOnly && (
        <div className="bg-green-50 border-t border-green-200 px-5 py-3 text-sm text-green-700 shrink-0">This build was already deducted from stock (order packed).</div>
      )}
    </div>
  );
}

function AddSlotButton({ onAdd, existing }: { onAdd: (cat: string) => void; existing: string[] }) {
  const [open, setOpen] = useState(false);
  const options = INVENTORY_CATEGORIES.filter((c) => !existing.includes(c.key));
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-xl border-2 border-dashed border-slate-300 p-4 bg-white text-slate-400 hover:border-blue-400 hover:text-blue-500 flex items-center justify-center gap-2">
        <Plus className="h-4 w-4" /> Add part
      </button>
    );
  }
  return (
    <div className="rounded-xl border-2 border-slate-300 p-3 bg-white space-y-1 max-h-56 overflow-y-auto">
      {options.map((c) => (
        <button key={c.key} onClick={() => { onAdd(c.key); setOpen(false); }} className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-slate-100">{c.label}</button>
      ))}
    </div>
  );
}

function SlotPicker({ slot, parts, stockUnits, stockLevels, builds, filters, setFilters, onPick, onPickCatalog }: {
  slot: string;
  parts: ReturnType<typeof useOrderStore.getState>['inventoryParts'];
  stockUnits: ReturnType<typeof useOrderStore.getState>['stockUnits'];
  stockLevels: ReturnType<typeof useOrderStore.getState>['stockLevels'];
  builds: ReturnType<typeof useOrderStore.getState>['builds'];
  filters: Record<string, string>;
  setFilters: (f: Record<string, string>) => void;
  onPick: (sel: Selection) => void;
  onPickCatalog: (cp: CatalogProduct, qty: number) => void;
}) {
  const cat = INVENTORY_CATEGORY_MAP[slot];
  const serialized = cat?.tracking === 'serialized';
  const [qtyByPart, setQtyByPart] = useState<Record<string, number>>({});

  const catParts = useMemo(() => parts.filter((p) => p.category === slot), [parts, slot]);
  const catalogCat = INVENTORY_TO_CATALOG_CATEGORY[slot];

  // Filter chips from identifying attributes with distinct in-stock values.
  const filterAttrs = (cat?.attributes ?? []).filter((a) => a.identifying);
  const distinct = (key: string) => Array.from(new Set(catParts.map((p) => String(p.attributes[key] ?? '')).filter(Boolean)));

  const filtered = catParts.filter((p) => filterAttrs.every((a) => !filters[a.key] || String(p.attributes[a.key] ?? '') === filters[a.key]));

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {catParts.length === 0 && (
        <div className="text-center py-8 text-slate-400">
          <CircleAlert className="h-8 w-8 mx-auto mb-2 text-slate-200" />
          <p className="text-sm font-medium">No {cat?.label ?? slot} in stock{catalogCat ? ' — pick one from the catalog below' : ''}</p>
          {!catalogCat && <p className="text-xs mt-1">Receive it via Inventory → Goods Inward, then it&apos;ll appear here.</p>}
        </div>
      )}
      {/* Filter chips per identifying attribute */}
      {filterAttrs.map((a) => {
        const vals = distinct(a.key);
        if (vals.length <= 1) return null;
        return (
          <div key={a.key} className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium text-slate-400 w-20 shrink-0">{a.label}</span>
            {vals.map((v) => (
              <button key={v} onClick={() => setFilters({ ...filters, [a.key]: filters[a.key] === v ? '' : v })}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium ${filters[a.key] === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                {v}{a.unit ?? ''}
              </button>
            ))}
          </div>
        );
      })}

      {/* Parts */}
      <div className="space-y-2">
        {filtered.map((p) => {
          const avail = computeAvailability(p.id, p, stockLevels, stockUnits, builds);
          const units = serialized ? stockUnits.filter((u) => u.partId === p.id && u.status === 'in_stock') : [];
          const qty = qtyByPart[p.id] ?? 1;
          return (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{describeAttributes(p.category, p.attributes) || p.name}</p>
                  <p className={`text-xs ${avail.available < 0 ? 'text-red-600' : 'text-slate-400'}`}>{avail.available} available{avail.reserved ? ` · ${avail.reserved} on hold` : ''}</p>
                </div>
                {!serialized && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setQtyByPart((q) => ({ ...q, [p.id]: Math.max(1, qty - 1) }))} className="p-1 rounded hover:bg-slate-100 text-slate-500"><Minus className="h-4 w-4" /></button>
                    <span className="w-6 text-center text-sm font-bold">{qty}</span>
                    <button onClick={() => setQtyByPart((q) => ({ ...q, [p.id]: qty + 1 }))} className="p-1 rounded hover:bg-slate-100 text-slate-500"><Plus className="h-4 w-4" /></button>
                    <Button size="sm" onClick={() => onPick({ partId: p.id, quantity: qty })}>Select</Button>
                  </div>
                )}
              </div>
              {serialized && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {units.length === 0 ? <span className="text-xs text-slate-400">No units in stock</span> : units.map((u) => (
                    <button key={u.id} onClick={() => onPick({ partId: p.id, stockUnitId: u.id, quantity: 1 })}
                      className="text-xs px-2 py-1 rounded-lg border border-slate-300 hover:bg-blue-50 hover:border-blue-400 flex items-center gap-1">
                      <Boxes className="h-3 w-3" /> {u.assetTag || u.id.slice(0, 8)}{u.grade ? ` · ${u.grade}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {catalogCat && <CatalogSlotPicker catalogCat={catalogCat} onPickCatalog={onPickCatalog} />}
    </div>
  );
}

/** Pick a component for this slot from the reference catalog (materializes a part on select). */
function CatalogSlotPicker({ catalogCat, onPickCatalog }: { catalogCat: string; onPickCatalog: (cp: CatalogProduct, qty: number) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [qtyById, setQtyById] = useState<Record<string, number>>({});

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const t = setTimeout(async () => {
      const { rows } = await fetchCatalogPage({ q, category: catalogCat, pageSize: 20 });
      if (!live) return;
      setResults(rows);
      setLoading(false);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, catalogCat]);

  return (
    <div className="border-t border-slate-200 pt-4 space-y-2">
      <div className="flex items-center gap-2 text-slate-500">
        <Library className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">Add from catalog</span>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the product catalog…"
          className="w-full pl-9 pr-9 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 animate-spin" />}
      </div>
      <div className="space-y-2">
        {!loading && results.length === 0 ? (
          <p className="text-xs text-slate-400 py-2">No catalog matches.</p>
        ) : results.map((p) => {
          const qty = qtyById[p.id] ?? 1;
          return (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" className="h-10 w-10 object-contain rounded shrink-0" />
              ) : <div className="h-10 w-10 rounded bg-slate-100 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                <p className="text-[11px] text-slate-400 truncate">{Object.values(p.specs).slice(0, 3).map((v) => String(v)).join(' · ')}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setQtyById((m) => ({ ...m, [p.id]: Math.max(1, qty - 1) }))} className="p-1 rounded hover:bg-slate-100 text-slate-500"><Minus className="h-4 w-4" /></button>
                <span className="w-6 text-center text-sm font-bold">{qty}</span>
                <button onClick={() => setQtyById((m) => ({ ...m, [p.id]: qty + 1 }))} className="p-1 rounded hover:bg-slate-100 text-slate-500"><Plus className="h-4 w-4" /></button>
                <Button size="sm" variant="outline" onClick={() => onPickCatalog(p, qty)}>Select</Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
