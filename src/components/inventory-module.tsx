'use client';

import { useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { INVENTORY_CATEGORIES, INVENTORY_CATEGORY_MAP, describeAttributes, STOCK_UNIT_STATUS_CONFIG } from '@/lib/inventory-config';
import { computeAvailability } from '@/lib/inventory-utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { GoodsInwardForm } from './goods-inward-form';
import { ScanReceiving } from './scan-receiving';
import { Boxes, Search, PackagePlus, ChevronDown, ChevronRight, Warehouse, ScanLine } from 'lucide-react';

type Tab = 'stock' | 'scan' | 'receipts';

export function InventoryModule() {
  const parts = useOrderStore((s) => s.inventoryParts);
  const stockLevels = useOrderStore((s) => s.stockLevels);
  const stockUnits = useOrderStore((s) => s.stockUnits);
  const builds = useOrderStore((s) => s.builds);
  const goodsReceipts = useOrderStore((s) => s.goodsReceipts);

  const [tab, setTab] = useState<Tab>('stock');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');
  const [showInward, setShowInward] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => {
    return parts
      .map((p) => ({ part: p, avail: computeAvailability(p.id, p, stockLevels, stockUnits, builds) }))
      .filter(({ part }) => categoryFilter === 'all' || part.category === categoryFilter)
      .filter(({ part }) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return part.name.toLowerCase().includes(q) || part.sku.toLowerCase().includes(q) ||
          describeAttributes(part.category, part.attributes).toLowerCase().includes(q);
      })
      .sort((a, b) => a.part.category.localeCompare(b.part.category) || a.part.name.localeCompare(b.part.name));
  }, [parts, stockLevels, stockUnits, builds, categoryFilter, search]);

  const totals = useMemo(() => {
    const onHand = rows.reduce((s, r) => s + r.avail.onHand, 0);
    const reserved = rows.reduce((s, r) => s + r.avail.reserved, 0);
    return { skus: rows.length, onHand, reserved };
  }, [rows]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Warehouse className="h-6 w-6 text-blue-500" /> Inventory
          </h2>
          <p className="text-slate-500 text-sm mt-1">Parts &amp; stock · {totals.skus} SKUs · {totals.onHand} on hand · {totals.reserved} on hold</p>
        </div>
        <Button onClick={() => setShowInward(true)} className="bg-blue-600 hover:bg-blue-700 text-white">
          <PackagePlus className="h-4 w-4 mr-1.5" /> Goods Inward
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg border overflow-hidden text-sm w-fit">
        <button onClick={() => setTab('stock')} className={`px-5 py-2 font-medium ${tab === 'stock' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Stock</button>
        <button onClick={() => setTab('scan')} className={`px-5 py-2 font-medium flex items-center gap-1.5 ${tab === 'scan' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
          <ScanLine className="h-4 w-4" /> Scan In
        </button>
        <button onClick={() => setTab('receipts')} className={`px-5 py-2 font-medium ${tab === 'receipts' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
          Receipts {goodsReceipts.length > 0 && <span className="ml-1 text-xs opacity-75">({goodsReceipts.length})</span>}
        </button>
      </div>

      {tab === 'scan' ? (
        <ScanReceiving />
      ) : tab === 'stock' ? (
        <>
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input placeholder="Search part, SKU, spec…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-md text-sm">
              <option value="all">All categories</option>
              {INVENTORY_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>

          {rows.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Boxes className="h-12 w-12 mx-auto mb-3 text-slate-200" />
              <p className="font-medium">No stock yet</p>
              <p className="text-sm mt-1">Use Goods Inward to receive your first pallet.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {rows.map(({ part, avail }) => {
                const cat = INVENTORY_CATEGORY_MAP[part.category];
                const isSerialized = part.tracking === 'serialized';
                const units = isSerialized ? stockUnits.filter((u) => u.partId === part.id) : [];
                const low = part.lowStockThreshold !== undefined && avail.available <= part.lowStockThreshold;
                const open = expanded === part.id;
                return (
                  <div key={part.id} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                    <button
                      onClick={() => isSerialized && setExpanded(open ? null : part.id)}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50"
                    >
                      {isSerialized ? (open ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />) : <span className="w-4 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{describeAttributes(part.category, part.attributes) || part.name}</p>
                        <p className="text-xs text-slate-400">{cat?.label} · <span className="font-mono">{part.sku}</span> · {isSerialized ? 'serialized' : 'bulk'}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-right">
                        {avail.reserved > 0 && <span className="text-xs text-amber-600">{avail.reserved} on hold</span>}
                        <div>
                          <p className={`text-lg font-bold leading-none ${avail.available < 0 ? 'text-red-600' : low ? 'text-orange-600' : 'text-slate-800'}`}>{avail.available}</p>
                          <p className="text-[10px] text-slate-400">available</p>
                        </div>
                      </div>
                    </button>
                    {isSerialized && open && (
                      <div className="border-t bg-slate-50 px-4 py-2 space-y-1">
                        {units.length === 0 ? <p className="text-xs text-slate-400 py-1">No units.</p> : units.map((u) => {
                          const st = STOCK_UNIT_STATUS_CONFIG[u.status];
                          return (
                            <div key={u.id} className="flex items-center gap-2 text-xs py-0.5">
                              <span className={`px-1.5 py-0.5 rounded border ${st.color}`}>{st.label}</span>
                              <span className="font-mono text-slate-500">{u.assetTag || u.id.slice(0, 8)}</span>
                              {u.grade && <span className="text-slate-400">Grade {u.grade}</span>}
                              {u.location && <span className="text-slate-400">· {u.location}</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-1.5">
          {goodsReceipts.length === 0 ? (
            <p className="text-center py-16 text-slate-400 text-sm">No goods receipts yet.</p>
          ) : goodsReceipts.map((r) => (
            <div key={r.id} className="border border-slate-200 rounded-xl bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{r.reference}{r.supplier ? ` · ${r.supplier}` : ''}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(r.receivedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {r.receivedByName ? ` · ${r.receivedByName}` : ''} · {r.lines.reduce((s, l) => s + l.quantity, 0)} items
                  </p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${r.status === 'posted' ? 'bg-green-100 text-green-800 border-green-300' : 'bg-slate-100 text-slate-600 border-slate-300'}`}>
                  {r.status === 'posted' ? 'Posted' : 'Draft'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showInward && <GoodsInwardForm onClose={() => setShowInward(false)} />}
    </div>
  );
}
