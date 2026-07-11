// ==================== INVENTORY CONFIG ====================
// The "modular + intelligent" core: categories and their attribute templates are
// data, not code. Add a category or a spec field here and the goods-inward form,
// catalog and stock views adapt automatically — no component changes needed.

export type StockTracking = 'serialized' | 'bulk';

export interface AttributeField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  options?: string[];
  unit?: string;
  /** Part of the auto-generated SKU / used to match identical parts */
  identifying?: boolean;
}

export interface InventoryCategory {
  key: string;
  label: string;
  /** serialized = each unit tracked individually (laptops/PCs); bulk = quantity per SKU (RAM/SSD) */
  tracking: StockTracking;
  /** Maps to the existing product taxonomy where relevant (csv categoriser) */
  productCategory?: string;
  attributes: AttributeField[];
}

const GRADE_OPTIONS = ['A', 'B', 'C', 'D', 'Spares / Faulty'];

export const INVENTORY_CATEGORIES: InventoryCategory[] = [
  {
    key: 'laptop',
    label: 'Laptop',
    tracking: 'serialized',
    productCategory: 'LAPTOP',
    attributes: [
      { key: 'brand', label: 'Brand', type: 'text', identifying: true },
      { key: 'model', label: 'Model', type: 'text', identifying: true },
      { key: 'cpu', label: 'CPU', type: 'text', identifying: true },
      { key: 'ram', label: 'RAM', type: 'text', unit: 'GB' },
      { key: 'storage', label: 'Storage', type: 'text' },
      { key: 'screen', label: 'Screen', type: 'text', unit: '"' },
      { key: 'resolution', label: 'Resolution', type: 'text' },
      { key: 'gpu', label: 'GPU', type: 'text' },
    ],
  },
  {
    key: 'desktop',
    label: 'Desktop / AIO / Mini',
    tracking: 'serialized',
    productCategory: 'PC-AIO-MINI',
    attributes: [
      { key: 'brand', label: 'Brand', type: 'text', identifying: true },
      { key: 'model', label: 'Model', type: 'text', identifying: true },
      { key: 'form_factor', label: 'Form factor', type: 'select', options: ['Tower', 'SFF', 'USFF', 'Mini', 'All-in-One'] },
      { key: 'cpu', label: 'CPU', type: 'text', identifying: true },
      { key: 'ram', label: 'RAM', type: 'text', unit: 'GB' },
      { key: 'storage', label: 'Storage', type: 'text' },
      { key: 'gpu', label: 'GPU', type: 'text' },
    ],
  },
  {
    key: 'monitor',
    label: 'Monitor',
    tracking: 'serialized',
    productCategory: 'MONITOR',
    attributes: [
      { key: 'brand', label: 'Brand', type: 'text', identifying: true },
      { key: 'model', label: 'Model', type: 'text', identifying: true },
      { key: 'size', label: 'Size', type: 'number', unit: '"', identifying: true },
      { key: 'resolution', label: 'Resolution', type: 'text' },
      { key: 'panel', label: 'Panel', type: 'select', options: ['IPS', 'TN', 'VA', 'OLED'] },
    ],
  },
  {
    key: 'ram',
    label: 'RAM',
    tracking: 'bulk',
    productCategory: 'MB/RAM/HDD/SSD',
    attributes: [
      { key: 'type', label: 'Type', type: 'select', options: ['DDR3', 'DDR4', 'DDR5'], identifying: true },
      { key: 'capacity', label: 'Capacity', type: 'number', unit: 'GB', identifying: true },
      { key: 'form_factor', label: 'Form factor', type: 'select', options: ['SODIMM', 'DIMM'], identifying: true },
      { key: 'speed', label: 'Speed', type: 'text', unit: 'MHz' },
    ],
  },
  {
    key: 'storage',
    label: 'Storage (HDD / SSD)',
    tracking: 'bulk',
    productCategory: 'MB/RAM/HDD/SSD',
    attributes: [
      { key: 'type', label: 'Type', type: 'select', options: ['HDD', 'SSD', 'NVMe'], identifying: true },
      { key: 'capacity', label: 'Capacity', type: 'text', identifying: true },
      { key: 'interface', label: 'Interface', type: 'select', options: ['SATA', 'NVMe', 'SAS'], identifying: true },
      { key: 'form_factor', label: 'Form factor', type: 'select', options: ['2.5"', '3.5"', 'M.2'] },
    ],
  },
  {
    key: 'cpu',
    label: 'Processor',
    tracking: 'bulk',
    productCategory: 'MB/RAM/HDD/SSD',
    attributes: [
      { key: 'brand', label: 'Brand', type: 'select', options: ['Intel', 'AMD'], identifying: true },
      { key: 'family', label: 'Family', type: 'select', options: ['Core i3', 'Core i5', 'Core i7', 'Core i9', 'Pentium', 'Celeron', 'Xeon', 'Ryzen 3', 'Ryzen 5', 'Ryzen 7', 'Ryzen 9', 'Other'], identifying: true },
      { key: 'generation', label: 'Generation', type: 'select', options: ['2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', '13th', '14th'], identifying: true },
      { key: 'model', label: 'Model', type: 'text' },
    ],
  },
  {
    key: 'charger',
    label: 'Charger / PSU',
    tracking: 'bulk',
    productCategory: 'MB/RAM/HDD/SSD',
    attributes: [
      { key: 'brand', label: 'Brand', type: 'text', identifying: true },
      { key: 'wattage', label: 'Wattage', type: 'number', unit: 'W', identifying: true },
      { key: 'connector', label: 'Connector', type: 'text', identifying: true },
    ],
  },
  {
    key: 'battery',
    label: 'Battery',
    tracking: 'bulk',
    productCategory: 'MB/RAM/HDD/SSD',
    attributes: [
      { key: 'compatible', label: 'Compatible with', type: 'text', identifying: true },
    ],
  },
  {
    key: 'motherboard',
    label: 'Motherboard',
    tracking: 'bulk',
    productCategory: 'MB/RAM/HDD/SSD',
    attributes: [
      { key: 'brand', label: 'Brand', type: 'text', identifying: true },
      { key: 'socket', label: 'Socket', type: 'select', options: ['LGA1151', 'LGA1200', 'LGA1700', 'AM4', 'AM5', 'Other'], identifying: true },
      { key: 'form_factor', label: 'Form factor', type: 'select', options: ['ATX', 'Micro-ATX', 'Mini-ITX'], identifying: true },
      { key: 'model', label: 'Model', type: 'text' },
    ],
  },
  {
    key: 'gpu',
    label: 'Graphics Card',
    tracking: 'bulk',
    productCategory: 'PC-GAMING',
    attributes: [
      { key: 'brand', label: 'Chipset', type: 'select', options: ['NVIDIA', 'AMD', 'Intel'], identifying: true },
      { key: 'model', label: 'Model', type: 'text', identifying: true },
      { key: 'memory', label: 'Memory', type: 'number', unit: 'GB', identifying: true },
    ],
  },
  {
    key: 'psu',
    label: 'Power Supply',
    tracking: 'bulk',
    productCategory: 'MB/RAM/HDD/SSD',
    attributes: [
      { key: 'wattage', label: 'Wattage', type: 'number', unit: 'W', identifying: true },
      { key: 'rating', label: 'Rating', type: 'select', options: ['80+ White', '80+ Bronze', '80+ Silver', '80+ Gold', '80+ Platinum'], identifying: true },
      { key: 'modular', label: 'Modular', type: 'select', options: ['Non', 'Semi', 'Full'] },
    ],
  },
  {
    key: 'case',
    label: 'Case',
    tracking: 'bulk',
    productCategory: 'MB/RAM/HDD/SSD',
    attributes: [
      { key: 'brand', label: 'Brand', type: 'text', identifying: true },
      { key: 'form_factor', label: 'Form factor', type: 'select', options: ['ATX', 'Micro-ATX', 'Mini-ITX', 'Full Tower', 'Mid Tower', 'SFF'], identifying: true },
      { key: 'model', label: 'Model', type: 'text' },
    ],
  },
  {
    key: 'cooler',
    label: 'CPU Cooler',
    tracking: 'bulk',
    productCategory: 'MB/RAM/HDD/SSD',
    attributes: [
      { key: 'type', label: 'Type', type: 'select', options: ['Air', 'AIO Liquid'], identifying: true },
      { key: 'model', label: 'Model', type: 'text', identifying: true },
    ],
  },
  {
    key: 'misc',
    label: 'Other / Misc part',
    tracking: 'bulk',
    productCategory: 'MB/RAM/HDD/SSD',
    attributes: [
      { key: 'description', label: 'Description', type: 'text', identifying: true },
    ],
  },
];

// Which component slots a build needs, by the order's product category. The
// assembler fills each slot from stock. First entry may be a serialized base unit.
export function requiredSlotsForCategory(productCategory: string | undefined): string[] {
  switch (productCategory) {
    case 'PC-GAMING':   return ['cpu', 'motherboard', 'ram', 'gpu', 'storage', 'psu', 'case', 'cooler'];
    case 'PC-AIO-MINI': return ['cpu', 'motherboard', 'ram', 'storage', 'psu', 'case'];
    case 'LAPTOP':      return ['laptop', 'ram', 'storage'];
    case 'MONITOR':     return ['monitor'];
    default:            return [];
  }
}

export const INVENTORY_CATEGORY_MAP: Record<string, InventoryCategory> = Object.fromEntries(
  INVENTORY_CATEGORIES.map((c) => [c.key, c]),
);

// Core internal components the assembler fits during the build. Everything else
// (monitor, charger/adapter, keyboards/mice/cables under "misc", etc.) is an
// accessory the PACKING department fits at the packing stage.
const CORE_BUILD_CATEGORIES = new Set([
  'laptop', 'desktop', 'ram', 'storage', 'cpu', 'motherboard', 'gpu', 'psu', 'case', 'cooler', 'battery',
]);

/** True for accessory/peripheral categories that are added at packing, not assembly. */
export function isPackingStageCategory(categoryKey: string): boolean {
  return !CORE_BUILD_CATEGORIES.has(categoryKey);
}

export const STOCK_GRADES = GRADE_OPTIONS;

export type StockUnitStatus = 'in_stock' | 'in_build' | 'allocated' | 'listed' | 'sold' | 'scrapped';

export const STOCK_UNIT_STATUS_CONFIG: Record<StockUnitStatus, { label: string; color: string }> = {
  in_stock:  { label: 'In stock',  color: 'bg-green-100 text-green-800 border-green-300' },
  in_build:  { label: 'In build',  color: 'bg-amber-100 text-amber-800 border-amber-300' },
  allocated: { label: 'Allocated', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  listed:    { label: 'Listed',    color: 'bg-purple-100 text-purple-800 border-purple-300' },
  sold:      { label: 'Sold',      color: 'bg-slate-100 text-slate-600 border-slate-300' },
  scrapped:  { label: 'Scrapped',  color: 'bg-red-100 text-red-800 border-red-300' },
};

// A build = the parts allocated to an order. reserved = on hold (assembling);
// consumed = deducted from stock (order reached packed).
export type BuildStatus = 'draft' | 'reserved' | 'consumed' | 'cancelled';

export const BUILD_STATUS_CONFIG: Record<BuildStatus, { label: string; color: string }> = {
  draft:     { label: 'Draft',     color: 'bg-slate-100 text-slate-600 border-slate-300' },
  reserved:  { label: 'On hold',   color: 'bg-amber-100 text-amber-800 border-amber-300' },
  consumed:  { label: 'Deducted',  color: 'bg-green-100 text-green-800 border-green-300' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800 border-red-300' },
};

/** Human-readable spec string from a part's attributes, e.g. "Dell · Latitude 7430 · i5". */
export function describeAttributes(categoryKey: string, attributes: Record<string, string | number>): string {
  const cat = INVENTORY_CATEGORY_MAP[categoryKey];
  if (!cat) return '';
  return cat.attributes
    .map((a) => {
      const v = attributes[a.key];
      if (v === undefined || v === '' || v === null) return null;
      return `${v}${a.unit ?? ''}`;
    })
    .filter(Boolean)
    .join(' · ');
}

// ─── Component swaps (assembly) ──────────────────────────────────────────────
// During assembly a worker may pull a part out of a unit and put a different one
// in (e.g. 2×8GB out, 1×16GB in). Each category has a "swap dimension" — the one
// spec that varies in a swap — with predefined preset values shown as chips. Any
// category not listed falls back to its first identifying attribute; a free-text
// custom value is always allowed.
const SWAP_DIMENSION: Record<string, { key: string; values: (string | number)[] }> = {
  ram:         { key: 'capacity', values: [4, 8, 16, 32, 64] },
  storage:     { key: 'capacity', values: ['128GB', '256GB', '512GB', '1TB', '2TB', '4TB'] },
  cpu:         { key: 'family',   values: ['Core i3', 'Core i5', 'Core i7', 'Core i9', 'Ryzen 3', 'Ryzen 5', 'Ryzen 7', 'Ryzen 9'] },
  gpu:         { key: 'memory',   values: [2, 4, 6, 8, 12, 16] },
  charger:     { key: 'wattage',  values: [45, 65, 90, 120, 150] },
  psu:         { key: 'wattage',  values: [450, 550, 650, 750, 850] },
  motherboard: { key: 'socket',   values: ['LGA1151', 'LGA1200', 'LGA1700', 'AM4', 'AM5'] },
  case:        { key: 'form_factor', values: ['ATX', 'Micro-ATX', 'Mini-ITX', 'Mid Tower', 'Full Tower', 'SFF'] },
  cooler:      { key: 'type',     values: ['Air', 'AIO Liquid'] },
  battery:     { key: 'compatible', values: [] }, // free-text only
  monitor:     { key: 'size',     values: [22, 24, 27, 32] },
  laptop:      { key: 'ram',      values: [4, 8, 16, 32] },
  desktop:     { key: 'ram',      values: [4, 8, 16, 32, 64] },
  misc:        { key: 'description', values: [] },
};

export interface SwapPreset {
  label: string;                                   // chip text, e.g. "8GB"
  attributes: Record<string, string | number>;     // partial attrs, e.g. { capacity: 8 }
}

export interface SwapConfigOption { key: string; label: string; options: string[] }

export interface SwapConfig {
  dimensionKey: string;      // the attribute that varies (e.g. "capacity")
  dimensionLabel: string;    // human label (e.g. "Capacity")
  unit: string;              // e.g. "GB", "W", ""
  presets: SwapPreset[];     // predefined chips (may be empty → custom only)
  configs: SwapConfigOption[]; // secondary spec tiles, e.g. RAM type DDR3/DDR4/DDR5
}

/** Predefined swap options for a category's swap dimension (+ free-text always allowed). */
export function swapConfigForCategory(categoryKey: string): SwapConfig {
  const cat = INVENTORY_CATEGORY_MAP[categoryKey];
  const dim = SWAP_DIMENSION[categoryKey];
  // Fall back to the first identifying attribute for uncurated categories.
  const attrKey = dim?.key ?? cat?.attributes.find((a) => a.identifying)?.key ?? 'spec';
  const attr = cat?.attributes.find((a) => a.key === attrKey);
  const unit = attr?.unit ?? '';
  // Curated values, else the attribute's own select options, else free-text only.
  const values = dim?.values.length ? dim.values : (attr?.options ?? []);
  const presets: SwapPreset[] = values.map((v) => ({
    label: `${v}${unit}`,
    attributes: { [attrKey]: v },
  }));
  // Secondary config tiles: the category's other identifying select attributes
  // (e.g. RAM type DDR3/DDR4/DDR5, storage type SSD/HDD/NVMe).
  const configs: SwapConfigOption[] = (cat?.attributes ?? [])
    .filter((a) => a.identifying && a.type === 'select' && a.key !== attrKey && Array.isArray(a.options) && a.options.length)
    .slice(0, 2)
    .map((a) => ({ key: a.key, label: a.label, options: a.options as string[] }));
  return { dimensionKey: attrKey, dimensionLabel: attr?.label ?? 'Spec', unit, presets, configs };
}

/** Build the label + attributes for a custom (free-text) swap value. */
export function customSwapPreset(categoryKey: string, value: string): SwapPreset {
  const { dimensionKey, unit } = swapConfigForCategory(categoryKey);
  const trimmed = value.trim();
  return { label: unit && /^\d+$/.test(trimmed) ? `${trimmed}${unit}` : trimmed, attributes: { [dimensionKey]: trimmed } };
}

/** Stable SKU from category + identifying attributes, so identical parts match. */
export function buildSku(categoryKey: string, attributes: Record<string, string | number>): string {
  const cat = INVENTORY_CATEGORY_MAP[categoryKey];
  if (!cat) return categoryKey.toUpperCase();
  const ids = cat.attributes.filter((a) => a.identifying);
  const parts = ids
    .map((a) => String(attributes[a.key] ?? '').trim())
    .filter(Boolean)
    .map((v) => v.replace(/\s+/g, '-').toUpperCase());
  return [categoryKey.toUpperCase(), ...parts].join('-') || categoryKey.toUpperCase();
}
