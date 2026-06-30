'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { GoodsReceipt, GoodsReceiptLine, InventoryPart } from '@/lib/types';
import { INVENTORY_CATEGORIES, INVENTORY_CATEGORY_MAP, STOCK_GRADES, describeAttributes, buildSku } from '@/lib/inventory-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { ScanLine, Plus, Trash2, Minus, CheckCircle } from 'lucide-react';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const fieldCls = 'w-full px-2.5 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

interface ScanLineItem {
  partId: string;
  quantity: number;
}

export function ScanReceiving() {
  const parts = useOrderStore((s) => s.inventoryParts);
  const upsertInventoryPart = useOrderStore((s) => s.upsertInventoryPart);
  const saveGoodsReceipt = useOrderStore((s) => s.saveGoodsReceipt);
  const postGoodsReceipt = useOrderStore((s) => s.postGoodsReceipt);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));

  const [reference, setReference] = useState(`SCAN-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`);
  const [supplier, setSupplier] = useState('');
  const [grade, setGrade] = useState('B');
  const [location, setLocation] = useState('');

  const [scan, setScan] = useState('');
  const [items, setItems] = useState<ScanLineItem[]>([]);
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const focusScan = () => scanRef.current?.focus();
  useEffect(() => { focusScan(); }, []);

  function addOrIncrement(partId: string, by = 1) {
    setItems((prev) => {
      const found = prev.find((l) => l.partId === partId);
      if (found) return prev.map((l) => (l.partId === partId ? { ...l, quantity: Math.max(1, l.quantity + by) } : l));
      return [{ partId, quantity: 1 }, ...prev];
    });
  }

  function handleScan(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const part = parts.find((p) => (p.barcode ?? '').toLowerCase() === code.toLowerCase());
    if (part) {
      addOrIncrement(part.id);
      toast.success(`+1 ${describeAttributes(part.category, part.attributes) || part.name}`);
    } else {
      setPendingBarcode(code);   // unknown → create a new product
    }
    setScan('');
  }

  function removeItem(partId: string) {
    setItems((prev) => prev.filter((l) => l.partId !== partId));
  }

  const totalUnits = useMemo(() => items.reduce((s, l) => s + l.quantity, 0), [items]);

  function receive() {
    if (items.length === 0) { toast.error('Scan at least one item'); return; }
    const now = new Date().toISOString();
    const lines: GoodsReceiptLine[] = items.map((l) => {
      const part = parts.find((p) => p.id === l.partId)!;
      return {
        id: uuid(), partId: part.id, category: part.category, tracking: part.tracking,
        attributes: part.attributes, grade, quantity: l.quantity, location: location || undefined,
      };
    });
    const receipt: GoodsReceipt = {
      id: uuid(), reference: reference.trim() || 'SCAN', supplier: supplier.trim() || undefined,
      status: 'draft', lines, receivedAt: now, receivedById: currentUser?.id, receivedByName: currentUser?.name,
      createdAt: now, updatedAt: now,
    };
    saveGoodsReceipt(receipt);
    postGoodsReceipt(receipt.id);
    toast.success(`Received ${totalUnits} item${totalUnits !== 1 ? 's' : ''} into stock`);
    setItems([]);
    focusScan();
  }

  return (
    <div className="space-y-4">
      {/* Session settings */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className="text-[11px] font-medium text-slate-500 block mb-1">Reference</label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-500 block mb-1">Supplier</label>
          <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-500 block mb-1">Grade</label>
          <select value={grade} onChange={(e) => setGrade(e.target.value)} className={fieldCls}>
            {STOCK_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-500 block mb-1">Location</label>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bay / shelf" />
        </div>
      </div>

      {/* Scan input */}
      <div className="relative">
        <ScanLine className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-blue-500" />
        <input
          ref={scanRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleScan(scan); }}
          onBlur={() => { if (!pendingBarcode) setTimeout(focusScan, 50); }}
          placeholder="Scan a barcode…"
          className="w-full pl-14 pr-4 py-4 text-lg border-2 border-blue-300 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-500"
        />
        <p className="text-xs text-slate-400 mt-1 text-center">Cursor stays here — just scan. Unknown barcodes prompt a quick new-product form.</p>
      </div>

      {/* Scanned session list */}
      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((l) => {
            const part = parts.find((p) => p.id === l.partId);
            if (!part) return null;
            return (
              <div key={l.partId} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">{describeAttributes(part.category, part.attributes) || part.name}</p>
                  <p className="text-xs text-slate-400">{INVENTORY_CATEGORY_MAP[part.category]?.label} · <span className="font-mono">{part.barcode}</span></p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => addOrIncrement(l.partId, -1)} className="p-1 rounded hover:bg-slate-100 text-slate-500"><Minus className="h-4 w-4" /></button>
                  <span className="w-8 text-center font-bold text-blue-700">{l.quantity}</span>
                  <button onClick={() => addOrIncrement(l.partId, 1)} className="p-1 rounded hover:bg-slate-100 text-slate-500"><Plus className="h-4 w-4" /></button>
                  <button onClick={() => removeItem(l.partId)} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-red-500 ml-1"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-slate-500">{totalUnits} items in this session</p>
            <Button onClick={receive}><CheckCircle className="h-4 w-4 mr-1.5" /> Receive into stock</Button>
          </div>
        </div>
      )}

      {pendingBarcode && (
        <NewProductForm
          barcode={pendingBarcode}
          onCancel={() => { setPendingBarcode(null); focusScan(); }}
          onCreate={(part) => {
            upsertInventoryPart(part);
            addOrIncrement(part.id);
            setPendingBarcode(null);
            toast.success('New product created & added');
            focusScan();
          }}
        />
      )}
    </div>
  );
}

function NewProductForm({ barcode, onCreate, onCancel }: { barcode: string; onCreate: (p: InventoryPart) => void; onCancel: () => void }) {
  const [categoryKey, setCategoryKey] = useState(INVENTORY_CATEGORIES[0].key);
  const [attributes, setAttributes] = useState<Record<string, string | number>>({});
  const [bc, setBc] = useState(barcode);
  const category = INVENTORY_CATEGORY_MAP[categoryKey];

  function create() {
    const hasAttr = Object.values(attributes).some((v) => String(v).trim() !== '');
    if (!hasAttr) { toast.error('Fill at least one spec field'); return; }
    const now = new Date().toISOString();
    const sku = buildSku(categoryKey, attributes);
    onCreate({
      id: uuid(), sku, category: categoryKey, tracking: category.tracking,
      name: `${category.label} ${sku.replace(categoryKey.toUpperCase(), '').replace(/-/g, ' ')}`.trim(),
      attributes, barcode: bc.trim() || undefined, createdAt: now, updatedAt: now,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b">
          <h3 className="text-lg font-bold text-slate-900">New product</h3>
          <p className="text-xs text-slate-400 mt-0.5">Barcode <span className="font-mono">{barcode}</span> isn’t in the catalogue yet.</p>
        </div>
        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          <div>
            <label className="text-[11px] font-medium text-slate-500 block mb-1">Category</label>
            <select value={categoryKey} onChange={(e) => { setCategoryKey(e.target.value); setAttributes({}); }} className={fieldCls}>
              {INVENTORY_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}{c.tracking === 'serialized' ? ' (unit)' : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {category.attributes.map((a) => (
              <div key={a.key}>
                <label className="text-[11px] font-medium text-slate-500 block mb-1">{a.label}{a.unit ? ` (${a.unit})` : ''}</label>
                {a.type === 'select' ? (
                  <select value={String(attributes[a.key] ?? '')} onChange={(e) => setAttributes((p) => ({ ...p, [a.key]: e.target.value }))} className={fieldCls}>
                    <option value="">—</option>
                    {a.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <Input type={a.type === 'number' ? 'number' : 'text'} value={String(attributes[a.key] ?? '')} onChange={(e) => setAttributes((p) => ({ ...p, [a.key]: e.target.value }))} />
                )}
              </div>
            ))}
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-500 block mb-1">Barcode</label>
            <Input value={bc} onChange={(e) => setBc(e.target.value)} className="font-mono" />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={create}>Create &amp; add</Button>
        </div>
      </div>
    </div>
  );
}
