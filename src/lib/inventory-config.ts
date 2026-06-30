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
    label: 'CPU',
    tracking: 'bulk',
    productCategory: 'MB/RAM/HDD/SSD',
    attributes: [
      { key: 'brand', label: 'Brand', type: 'select', options: ['Intel', 'AMD'], identifying: true },
      { key: 'model', label: 'Model', type: 'text', identifying: true },
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
    key: 'misc',
    label: 'Other / Misc part',
    tracking: 'bulk',
    productCategory: 'MB/RAM/HDD/SSD',
    attributes: [
      { key: 'description', label: 'Description', type: 'text', identifying: true },
    ],
  },
];

export const INVENTORY_CATEGORY_MAP: Record<string, InventoryCategory> = Object.fromEntries(
  INVENTORY_CATEGORIES.map((c) => [c.key, c]),
);

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
