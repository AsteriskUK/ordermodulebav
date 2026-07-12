'use client';

import { useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { Department, DEPARTMENT_CONFIG, Order } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ListChecks, Check, Undo2, Tag, Minus, ChevronLeft, Cpu, MemoryStick, HardDrive, Boxes } from 'lucide-react';
import { toast } from 'sonner';

// Only these order categories are assembled from components. Monitors, networking,
// etc. ship as-is — the picker just confirms them.
const NEEDS_COMPONENTS = new Set(['LAPTOP', 'PC-GAMING', 'PC-AIO-MINI']);

// A component the picker adds. Drill categories (cpu/ram/storage) flip to a spec
// panel; generic ones add on a single tap.
interface PickedSpec { category: string; label: string; attributes: Record<string, string | number>; count: number; }

const CPU_FAMILIES: { label: string; value: string; brand: string }[] = [
  { label: 'i3', value: 'Core i3', brand: 'Intel' },
  { label: 'i5', value: 'Core i5', brand: 'Intel' },
  { label: 'i7', value: 'Core i7', brand: 'Intel' },
  { label: 'i9', value: 'Core i9', brand: 'Intel' },
  { label: 'Xeon', value: 'Xeon', brand: 'Intel' },
  { label: 'Ryzen 5', value: 'Ryzen 5', brand: 'AMD' },
  { label: 'Ryzen 7', value: 'Ryzen 7', brand: 'AMD' },
];
const CPU_GENS = ['2nd', '3rd', '4th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', '13th', '14th'];
const RAM_CAPS = [4, 8, 16, 32, 64];
const STORAGE_TYPES = ['SSD', 'HDD', 'NVMe'];
const STORAGE_CAPS = ['128GB', '256GB', '512GB', '1TB', '2TB'];

// Which component slots each order category needs, in order.
function slotsFor(cat: string): string[] {
  if (cat === 'LAPTOP') return ['ram', 'storage'];
  if (cat === 'PC-AIO-MINI') return ['cpu', 'ram', 'storage', 'motherboard', 'psu', 'case', 'cooler'];
  if (cat === 'PC-GAMING') return ['cpu', 'ram', 'storage', 'gpu', 'motherboard', 'psu', 'case', 'cooler'];
  return [];
}
const GENERIC_LABELS: Record<string, string> = { motherboard: 'Motherboard', gpu: 'GPU', psu: 'PSU', case: 'Case', cooler: 'CPU Cooler' };
const DRILL = new Set(['cpu', 'ram', 'storage']);
const SLOT_ICON: Record<string, typeof Cpu> = { cpu: Cpu, ram: MemoryStick, storage: HardDrive };
const SLOT_LABEL: Record<string, string> = { cpu: 'Processor', ram: 'RAM', storage: 'Storage' };

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

// One order's pick card: tap a component tile; Processor/RAM/Storage flip to a
// spec panel. Picked specs collect below with counters.
function PickerCard({ order, onSubmit }: { order: Order; onSubmit: (specs: PickedSpec[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);       // which drill panel is flipped open
  const [picked, setPicked] = useState<Record<string, PickedSpec>>({});
  const [cpuFamily, setCpuFamily] = useState<typeof CPU_FAMILIES[number] | null>(null);
  const [storageType, setStorageType] = useState('SSD');

  const slots = slotsFor(order.category);
  const total = Object.values(picked).reduce((s, p) => s + p.count, 0);

  const add = (category: string, label: string, attributes: Record<string, string | number>) => {
    const key = `${category}:${label}`;
    setPicked((p) => ({ ...p, [key]: { category, label, attributes, count: (p[key]?.count ?? 0) + 1 } }));
  };
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

      {/* Spec panel (flipped open) or the component tiles */}
      {open ? (
        <div className="mt-3 rounded-lg border border-slate-200 p-2.5">
          <button onClick={() => { setOpen(null); setCpuFamily(null); }} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-2">
            <ChevronLeft className="h-3.5 w-3.5" /> {SLOT_LABEL[open]} — tap a spec
          </button>

          {open === 'ram' && (
            <div className="flex flex-wrap gap-1.5">
              {RAM_CAPS.map((cap) => (
                <button key={cap} className={chip(false)} onClick={() => add('ram', `${cap}GB RAM`, { capacity: cap })}>{cap}GB</button>
              ))}
            </div>
          )}

          {open === 'storage' && (
            <>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {STORAGE_TYPES.map((t) => (
                  <button key={t} className={chip(storageType === t)} onClick={() => setStorageType(t)}>{t}</button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {STORAGE_CAPS.map((cap) => (
                  <button key={cap} className={chip(false)} onClick={() => add('storage', `${cap} ${storageType}`, { type: storageType, capacity: cap })}>{cap}</button>
                ))}
              </div>
            </>
          )}

          {open === 'cpu' && (
            <>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {CPU_FAMILIES.map((f) => (
                  <button key={f.value} className={chip(cpuFamily?.value === f.value)} onClick={() => setCpuFamily(f)}>{f.label}</button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mb-1">{cpuFamily ? `${cpuFamily.label} — tap a generation` : 'Pick a family first'}</p>
              <div className="flex flex-wrap gap-1.5">
                {CPU_GENS.map((g) => (
                  <button
                    key={g}
                    disabled={!cpuFamily}
                    className={`${chip(false)} disabled:opacity-40`}
                    onClick={() => cpuFamily && add('cpu', `${cpuFamily.label} ${g} gen`, { brand: cpuFamily.brand, family: cpuFamily.value, generation: g })}
                  >{g}</button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {slots.map((slot) => {
            const isDrill = DRILL.has(slot);
            const n = countFor(slot);
            const Icon = SLOT_ICON[slot] ?? Boxes;
            const label = SLOT_LABEL[slot] ?? GENERIC_LABELS[slot] ?? slot;
            return (
              <button
                key={slot}
                onClick={() => isDrill ? setOpen(slot) : add(slot, label, {})}
                className={`relative rounded-lg border px-1 py-2.5 flex flex-col items-center gap-1 transition-colors ${n > 0 ? 'border-lime-400 bg-lime-50' : 'border-slate-200 bg-white hover:border-lime-400'}`}
              >
                <Icon className="h-4 w-4 text-slate-500" />
                <span className="text-[11px] font-medium text-slate-700 leading-tight text-center">{label}</span>
                {n > 0 && <span className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 rounded-full bg-lime-600 text-white text-[10px] font-bold flex items-center justify-center">{n}</span>}
                {isDrill && <span className="text-[9px] text-slate-400">tap to spec</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Picked components summary */}
      {total > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(picked).map(([key, p]) => (
            <span key={key} className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 pl-2 pr-1 py-0.5 text-xs text-slate-700">
              {p.label} ×{p.count}
              <button onClick={() => dec(key)} className="h-4 w-4 rounded-full bg-slate-300 hover:bg-slate-400 text-white flex items-center justify-center" title="Remove one"><Minus className="h-2.5 w-2.5" /></button>
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
