'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { GoodsReceipt, GoodsReceiptLine, CatalogProduct } from '@/lib/types';
import { INVENTORY_CATEGORIES, INVENTORY_CATEGORY_MAP, STOCK_GRADES, describeAttributes } from '@/lib/inventory-config';
import { searchCatalog, catalogToAttributes, CATALOG_TO_INVENTORY_CATEGORY } from '@/lib/catalog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Plus, Trash2, PackagePlus, X, Search, Loader2 } from 'lucide-react';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const fieldCls = 'w-full px-2.5 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export function GoodsInwardForm({ onClose }: { onClose: () => void }) {
  const saveGoodsReceipt = useOrderStore((s) => s.saveGoodsReceipt);
  const postGoodsReceipt = useOrderStore((s) => s.postGoodsReceipt);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));

  const [reference, setReference] = useState(`PALLET-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`);
  const [supplier, setSupplier] = useState('');
  const [lines, setLines] = useState<GoodsReceiptLine[]>([]);

  // Current line draft — kept sticky (category/grade/location) for fast repeat entry.
  const [categoryKey, setCategoryKey] = useState(INVENTORY_CATEGORIES[0].key);
  const [attributes, setAttributes] = useState<Record<string, string | number>>({});
  const [grade, setGrade] = useState('B');
  const [quantity, setQuantity] = useState(1);
  const [location, setLocation] = useState('');
  const [unitCost, setUnitCost] = useState<number | ''>('');
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Reference-catalog lookup — pick a known product to prefill specs + image.
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogResults, setCatalogResults] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogProduct | null>(null);

  const category = INVENTORY_CATEGORY_MAP[categoryKey];

  const setAttr = (key: string, value: string) => setAttributes((a) => ({ ...a, [key]: value }));

  // Debounced catalog search.
  useEffect(() => {
    const q = catalogQuery.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q.length < 2) { setCatalogResults([]); return; }
    let live = true;
    setCatalogLoading(true);
    const t = setTimeout(async () => {
      const rows = await searchCatalog(q);
      if (!live) return;
      setCatalogResults(rows);
      setCatalogLoading(false);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [catalogQuery]);

  function pickCatalog(p: CatalogProduct) {
    const invKey = CATALOG_TO_INVENTORY_CATEGORY[p.category];
    if (invKey && INVENTORY_CATEGORY_MAP[invKey]) {
      setCategoryKey(invKey);
      setAttributes(catalogToAttributes(invKey, p));
    }
    if (p.msrp) setUnitCost(p.msrp);
    setSelectedCatalog(p);
    setCatalogQuery('');
    setCatalogResults([]);
  }

  function clearCatalog() {
    setSelectedCatalog(null);
    setAttributes({});
  }

  function addLine() {
    const hasAnyAttr = Object.values(attributes).some((v) => String(v).trim() !== '');
    if (!hasAnyAttr) { toast.error('Fill at least one spec field'); firstFieldRef.current?.focus(); return; }
    if (!quantity || quantity < 1) { toast.error('Quantity must be at least 1'); return; }
    setLines((prev) => [
      ...prev,
      {
        id: uuid(),
        category: categoryKey,
        tracking: category.tracking,
        attributes: { ...attributes },
        grade,
        quantity,
        location: location || undefined,
        unitCost: unitCost === '' ? undefined : Number(unitCost),
        catalogProductId: selectedCatalog?.id,
        catalogName: selectedCatalog?.name,
        catalogImageUrl: selectedCatalog?.imageUrl,
      },
    ]);
    // Reset spec + qty + catalog link, keep category/grade/location for the next item.
    setAttributes({});
    setQuantity(1);
    setUnitCost('');
    setSelectedCatalog(null);
    firstFieldRef.current?.focus();
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  const totalUnits = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines]);
  const totalCost = useMemo(() => lines.reduce((s, l) => s + (l.unitCost ?? 0) * l.quantity, 0), [lines]);

  function buildReceipt(): GoodsReceipt {
    const now = new Date().toISOString();
    return {
      id: uuid(), reference: reference.trim() || 'PALLET', supplier: supplier.trim() || undefined,
      status: 'draft', lines, totalCost: totalCost || undefined, receivedAt: now,
      receivedById: currentUser?.id, receivedByName: currentUser?.name, createdAt: now, updatedAt: now,
    };
  }

  function receive() {
    if (lines.length === 0) { toast.error('Add at least one line'); return; }
    const receipt = buildReceipt();
    saveGoodsReceipt(receipt);   // saved as draft first
    postGoodsReceipt(receipt.id); // then posted → creates stock
    toast.success(`Received ${totalUnits} item${totalUnits !== 1 ? 's' : ''} into stock`);
    onClose();
  }

  function saveDraft() {
    if (lines.length === 0) { toast.error('Add at least one line'); return; }
    saveGoodsReceipt(buildReceipt());
    toast.success('Saved as draft');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><PackagePlus className="h-5 w-5 text-blue-600" /> Goods Inward</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[78vh] overflow-y-auto">
          {/* Receipt header */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Pallet / delivery ref</label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 block mb-1">Supplier (optional)</label>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier" />
            </div>
          </div>

          {/* Fast line entry */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
            {/* Catalog lookup */}
            <div className="relative">
              <label className="text-[11px] font-medium text-slate-500 block mb-1">Find in product catalog</label>
              {selectedCatalog ? (
                <div className="flex items-center gap-2 bg-white border border-blue-200 rounded-md px-2 py-1.5">
                  {selectedCatalog.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selectedCatalog.imageUrl} alt="" className="h-8 w-8 object-contain rounded shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{selectedCatalog.name}</p>
                    <p className="text-[11px] text-slate-400">Specs prefilled from catalog · linked</p>
                  </div>
                  <button onClick={clearCatalog} className="text-slate-400 hover:text-red-500 shrink-0" title="Clear"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      value={catalogQuery}
                      onChange={(e) => setCatalogQuery(e.target.value)}
                      placeholder="Search 4,500+ products by name (e.g. Ryzen 7 9800X3D)"
                      className="pl-8"
                    />
                    {catalogLoading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 animate-spin" />}
                  </div>
                  {catalogResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
                      {catalogResults.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => pickCatalog(p)}
                          className="flex items-center gap-2 w-full text-left px-2.5 py-2 hover:bg-blue-50 border-b border-slate-100 last:border-0"
                        >
                          {p.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.imageUrl} alt="" className="h-9 w-9 object-contain rounded shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                            <p className="text-[11px] text-slate-400 truncate">
                              <span className="uppercase">{p.category}</span>
                              {Object.entries(p.specs).slice(0, 3).map(([k, v]) => ` · ${v}`).join('')}
                            </p>
                          </div>
                          {p.msrp != null && <span className="text-xs text-slate-500 shrink-0">£{p.msrp}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[11px] font-medium text-slate-500 block mb-1">Category</label>
                <select value={categoryKey} onChange={(e) => { setCategoryKey(e.target.value); setAttributes({}); setSelectedCatalog(null); }} className={fieldCls}>
                  {INVENTORY_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}{c.tracking === 'serialized' ? ' (unit)' : ''}</option>)}
                </select>
              </div>
              {category.attributes.map((a, i) => (
                <div key={a.key}>
                  <label className="text-[11px] font-medium text-slate-500 block mb-1">{a.label}{a.unit ? ` (${a.unit})` : ''}</label>
                  {a.type === 'select' ? (
                    <select value={String(attributes[a.key] ?? '')} onChange={(e) => setAttr(a.key, e.target.value)} className={fieldCls}>
                      <option value="">—</option>
                      {a.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <Input
                      ref={i === 0 ? firstFieldRef : undefined}
                      type={a.type === 'number' ? 'number' : 'text'}
                      value={String(attributes[a.key] ?? '')}
                      onChange={(e) => setAttr(a.key, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addLine(); }}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
              <div>
                <label className="text-[11px] font-medium text-slate-500 block mb-1">Grade</label>
                <select value={grade} onChange={(e) => setGrade(e.target.value)} className={fieldCls}>
                  {STOCK_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 block mb-1">Quantity</label>
                <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value) || 1)} onKeyDown={(e) => { if (e.key === 'Enter') addLine(); }} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 block mb-1">Location</label>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bay / shelf" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500 block mb-1">Unit cost £</label>
                <Input type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value === '' ? '' : Number(e.target.value))} />
              </div>
            </div>
            <Button onClick={addLine} size="sm" className="w-full"><Plus className="h-4 w-4 mr-1" /> Add line (Enter)</Button>
          </div>

          {/* Lines */}
          {lines.length > 0 && (
            <div className="space-y-1.5">
              {lines.map((l) => (
                <div key={l.id} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
                  <span className="font-bold text-blue-700 w-10 shrink-0">×{l.quantity}</span>
                  {l.catalogImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.catalogImageUrl} alt="" className="h-8 w-8 object-contain rounded shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800 truncate">
                      {l.catalogName ?? `${INVENTORY_CATEGORY_MAP[l.category]?.label}: ${describeAttributes(l.category, l.attributes)}`}
                    </p>
                    <p className="text-xs text-slate-400">
                      Grade {l.grade}{l.location ? ` · ${l.location}` : ''}{l.unitCost ? ` · £${l.unitCost} ea` : ''}
                      {l.tracking === 'serialized' ? ' · serialized' : ''}
                    </p>
                  </div>
                  <button onClick={() => removeLine(l.id)} className="text-slate-400 hover:text-red-500 shrink-0"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <p className="text-xs text-slate-500 text-right pt-1">{totalUnits} items{totalCost ? ` · £${totalCost.toFixed(2)} total` : ''}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t">
          <Button variant="outline" onClick={saveDraft}>Save draft</Button>
          <Button onClick={receive} disabled={lines.length === 0}>Receive into stock</Button>
        </div>
      </div>
    </div>
  );
}
