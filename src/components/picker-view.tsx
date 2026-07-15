'use client';

import { useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { Department, DEPARTMENT_CONFIG, Order } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ListChecks, Check, Undo2, Tag, Minus, Plus, ChevronLeft, Cpu, MemoryStick, HardDrive, Boxes } from 'lucide-react';
import { swapConfigForCategory, customSwapPreset, SwapPreset, INVENTORY_CATEGORY_MAP } from '@/lib/inventory-config';
import { toast } from 'sonner';

// Only these order categories are assembled from components. Monitors, networking,
// etc. ship as-is — the picker just confirms them.
const NEEDS_COMPONENTS = new Set(['LAPTOP', 'PC-GAMING', 'PC-AIO-MINI']);

// A fully-specced component the picker has gathered, with a running count.
interface PickedSpec { category: string; label: string; attributes: Record<string, string | number>; count: number; }

// Which component slots each order category needs, in order.
function slotsFor(cat: string): string[] {
  if (cat === 'LAPTOP') return ['ram', 'storage'];
  if (cat === 'PC-AIO-MINI') return ['cpu', 'ram', 'storage', 'motherboard', 'psu', 'case', 'cooler'];
  if (cat === 'PC-GAMING') return ['cpu', 'ram', 'storage', 'gpu', 'motherboard', 'psu', 'case', 'cooler'];
  return [];
}
const SLOT_ICON: Record<string, typeof Cpu> = { cpu: Cpu, ram: MemoryStick, storage: HardDrive };
// Card label — prefer the inventory schema's own label, fall back to the raw key.
const slotLabel = (slot: string) => INVENTORY_CATEGORY_MAP[slot]?.label ?? slot;

// Merge the picked dimension tile (e.g. 16GB) with the active config tiles
// (e.g. DDR4 · DIMM) into one labelled spec — mirrors assembly-builder's swap flow.
function withConfig(base: SwapPreset, config: Record<string, string>): SwapPreset {
  const extras = Object.values(config).filter(Boolean);
  return { label: [base.label, ...extras].join(' '), attributes: { ...base.attributes, ...config } };
}

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

const chip = (active: boolean) =>
  `px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${active ? 'bg-lime-600 text-white border-lime-600' : 'bg-white text-slate-700 border-slate-200 hover:border-lime-400'}`;

// Drill panel for one component slot: config tiles (e.g. RAM type DDR3/DDR4/DDR5,
// form factor) set the active spec, then tapping a dimension tile (e.g. 16GB) adds
// one fully-specced unit. All options come from the inventory schema via
// swapConfigForCategory, so they never drift from goods-inward / assembly.
function SlotDrill({ slot, onAdd, onBack }: { slot: string; onAdd: (spec: SwapPreset) => void; onBack: () => void }) {
  const cfg = swapConfigForCategory(slot);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState('');
  const context = Object.values(config).filter(Boolean).join(' · ');

  const commit = (base: SwapPreset) => onAdd(withConfig(base, config));

  return (
    <div className="mt-3 rounded-lg border border-slate-200 p-2.5">
      <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-2">
        <ChevronLeft className="h-3.5 w-3.5" /> {slotLabel(slot)}{context ? ` · ${context}` : ''} — tap to add
      </button>

      {/* Secondary spec tiles (type / form factor) — set the context first */}
      {cfg.configs.map((c) => (
        <div key={c.key} className="flex flex-wrap items-center gap-1.5 mb-1.5">
          <span className="text-[11px] text-slate-400 w-20 shrink-0">{c.label}</span>
          {c.options.map((opt) => {
            const selected = config[c.key] === opt;
            return (
              <button
                key={opt}
                onClick={() => setConfig({ ...config, [c.key]: selected ? '' : opt })}
                className={`text-xs px-2 py-0.5 rounded-md border font-medium transition-colors ${selected ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
              >{opt}</button>
            );
          })}
        </div>
      ))}

      {/* Primary dimension tiles — each tap adds/increments one specced unit */}
      {cfg.presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {cfg.presets.map((p) => (
            <button key={p.label} className={chip(false)} onClick={() => commit(p)}>{p.label}</button>
          ))}
        </div>
      )}

      {/* Free-text for odd values not in the presets */}
      <div className="flex items-center gap-1.5 mt-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) { commit(customSwapPreset(slot, custom)); setCustom(''); } }}
          placeholder={`Custom ${cfg.dimensionLabel.toLowerCase()}…`}
          className="flex-1 min-w-0 px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-lime-500"
        />
        <button
          onClick={() => { if (custom.trim()) { commit(customSwapPreset(slot, custom)); setCustom(''); } }}
          className="p-1.5 rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50"
          title="Add custom"
        ><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

// One order's pick card: tap a component tile to open its spec drill; picked specs
// collect below with +/- counters.
function PickerCard({ order, onSubmit }: { order: Order; onSubmit: (specs: PickedSpec[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);       // which drill panel is flipped open
  const [picked, setPicked] = useState<Record<string, PickedSpec>>({});

  const slots = slotsFor(order.category);
  const total = Object.values(picked).reduce((s, p) => s + p.count, 0);

  const add = (category: string, spec: SwapPreset) => {
    const key = `${category}:${spec.label}`;
    setPicked((p) => ({ ...p, [key]: { category, label: spec.label, attributes: spec.attributes, count: (p[key]?.count ?? 0) + 1 } }));
  };
  const inc = (key: string) => setPicked((p) => (p[key] ? { ...p, [key]: { ...p[key], count: p[key].count + 1 } } : p));
  const dec = (key: string) => setPicked((p) => {
    const n = { ...p };
    if (!n[key]) return n;
    const c = n[key].count - 1;
    if (c <= 0) delete n[key]; else n[key] = { ...n[key], count: c };
    return n;
  });
  const countFor = (category: string) => Object.values(picked).filter((p) => p.category === category).reduce((s, p) => s + p.count, 0);

  return (
    <div className="border border-slate-200 rounded-xl bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-mono text-slate-400">#{order.salesRecordNumber} · P{order.priority ?? 5} · {order.category}</p>
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

      {/* Spec drill (flipped open) or the component tiles */}
      {open ? (
        <SlotDrill slot={open} onAdd={(spec) => add(open, spec)} onBack={() => setOpen(null)} />
      ) : (
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {slots.map((slot) => {
            const n = countFor(slot);
            const Icon = SLOT_ICON[slot] ?? Boxes;
            return (
              <button
                key={slot}
                onClick={() => setOpen(slot)}
                className={`relative rounded-lg border px-1 py-2.5 flex flex-col items-center gap-1 transition-colors ${n > 0 ? 'border-lime-400 bg-lime-50' : 'border-slate-200 bg-white hover:border-lime-400'}`}
              >
                <Icon className="h-4 w-4 text-slate-500" />
                <span className="text-[11px] font-medium text-slate-700 leading-tight text-center">{slotLabel(slot)}</span>
                {n > 0 && <span className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 rounded-full bg-lime-600 text-white text-[10px] font-bold flex items-center justify-center">{n}</span>}
                <span className="text-[9px] text-slate-400">tap to spec</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Picked components summary — +/- to adjust each spec's count */}
      {total > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(picked).map(([key, p]) => (
            <span key={key} className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 pl-2 pr-1 py-0.5 text-xs text-slate-700">
              {p.label} ×{p.count}
              <button onClick={() => dec(key)} className="h-4 w-4 rounded-full bg-slate-300 hover:bg-slate-400 text-white flex items-center justify-center" title="Remove one"><Minus className="h-2.5 w-2.5" /></button>
              <button onClick={() => inc(key)} className="h-4 w-4 rounded-full bg-lime-600 hover:bg-lime-700 text-white flex items-center justify-center" title="Add one"><Plus className="h-2.5 w-2.5" /></button>
            </span>
          ))}
        </div>
      )}

      <Button
        onClick={() => onSubmit(Object.values(picked))}
        disabled={total === 0}
        className="w-full mt-3 bg-lime-600 hover:bg-lime-700 text-white disabled:opacity-50"
      >
        <Check className="h-4 w-4 mr-1.5" /> Submit {total > 0 ? `${total} picked` : ''} — deduct &amp; assign
      </Button>
    </div>
  );
}

export function PickerView() {
  const orders = useOrderStore((s) => s.orders);
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const setOrderPicked = useOrderStore((s) => s.setOrderPicked);
  const pickOrderComponents = useOrderStore((s) => s.pickOrderComponents);

  const currentUser = users.find((u) => u.id === currentUserId);
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'manager';
  const depts: Department[] = currentUser
    ? (currentUser.departments?.length ? currentUser.departments : [currentUser.department ?? 'management'])
    : [];
  const cats = isAdmin ? null : catsForDepts(depts);

  const visible = useMemo(() =>
    orders
      .filter((o) => !o.deletedAt && o.status === 'pending' && (o.postToAddress1 || o.postToPostcode) && (!cats || o.isGSP || cats.includes(o.category)))
      .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5) || (a.postByDate || a.saleDate).localeCompare(b.postByDate || b.saleDate)),
    [orders, cats]
  );
  const toPick = visible.filter((o) => !o.pickedAt);
  const picked = visible.filter((o) => o.pickedAt);

  function handleSubmit(orderId: string, specs: PickedSpec[]) {
    if (specs.length === 0) { toast.error('Tap the components you picked first.'); return; }
    pickOrderComponents(orderId, specs.map((s) => ({ category: s.category, label: s.label, attributes: s.attributes, quantity: s.count })));
    const total = specs.reduce((s, x) => s + x.count, 0);
    toast.success(`${total} component${total !== 1 ? 's' : ''} picked & deducted — ready for assembly`, { icon: '✅' });
  }

  function submitSimple(orderId: string) {
    setOrderPicked(orderId, true);
    toast.success('Confirmed — ready to ship', { icon: '✅' });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><ListChecks className="h-6 w-6 text-lime-600" /> Order Picker</h2>
        <p className="text-slate-500 text-sm mt-1">Tap the components you pick for each order — they&apos;re deducted from stock and tied to the order for assembly.</p>
      </div>

      {/* To pick */}
      <div>
        <h3 className="text-sm font-semibold text-slate-600 mb-2">To pick · {toPick.length}</h3>
        {toPick.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center border border-dashed rounded-xl">Nothing to pick right now.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {toPick.map((order) =>
              NEEDS_COMPONENTS.has(order.category) ? (
                <PickerCard key={order.id} order={order} onSubmit={(specs) => handleSubmit(order.id, specs)} />
              ) : (
                <div key={order.id} className="border border-slate-200 rounded-xl bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-mono text-slate-400">#{order.salesRecordNumber} · P{order.priority ?? 5} · {order.category}</p>
                      <p className="text-sm font-medium text-slate-800 leading-snug">{order.itemTitle}</p>
                    </div>
                    <span className="text-sm font-semibold text-slate-700 shrink-0">£{order.soldFor.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-3">No components to pick for {order.category.toLowerCase()} — confirm to move it on.</p>
                  <Button onClick={() => submitSimple(order.id)} className="w-full mt-2 bg-slate-700 hover:bg-slate-800 text-white">
                    <Check className="h-4 w-4 mr-1.5" /> Confirm — picked
                  </Button>
                </div>
              )
            )}
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
                <button onClick={() => setOrderPicked(order.id, false)} className="text-slate-400 hover:text-slate-700 shrink-0" title="Undo (does not restore stock)">
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
