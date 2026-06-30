import { Order, InventoryPart, StockUnit, BuildLine } from './types';
import { describeAttributes } from './inventory-config';

/** Map the existing product category to an inventory base-unit category. */
export function baseCategoryForOrder(order: Pick<Order, 'category'>): string | undefined {
  switch (order.category) {
    case 'LAPTOP': return 'laptop';
    case 'PC-GAMING':
    case 'PC-AIO-MINI': return 'desktop';
    case 'MONITOR': return 'monitor';
    default: return undefined;
  }
}

export interface SuggestedLine extends BuildLine {
  /** Set when we could not match a catalogue part for a parsed spec */
  note?: string;
}

function findPart(parts: InventoryPart[], category: string, predicate?: (p: InventoryPart) => boolean): InventoryPart | undefined {
  const inCat = parts.filter((p) => p.category === category);
  return (predicate ? inCat.find(predicate) : undefined) ?? inCat[0];
}

function firstAvailableUnit(units: StockUnit[], partId: string): StockUnit | undefined {
  return units.find((u) => u.partId === partId && u.status === 'in_stock');
}

/**
 * Suggest a bill of materials for an order: a serialized base unit matching the
 * order category (+ brand/model where detectable) plus bulk components parsed
 * from the title/variation (RAM, storage). Assembler confirms/adjusts before
 * reserving — so unmatched suggestions are fine.
 */
export function suggestBuildLines(order: Order, parts: InventoryPart[], stockUnits: StockUnit[]): SuggestedLine[] {
  const text = `${order.itemTitle ?? ''} ${order.variation ?? ''}`;
  const lines: SuggestedLine[] = [];

  // 1. Serialized base unit
  const baseCat = baseCategoryForOrder(order);
  if (baseCat) {
    const lower = text.toLowerCase();
    const part = findPart(parts, baseCat, (p) => {
      const brand = String(p.attributes.brand ?? '').toLowerCase();
      const model = String(p.attributes.model ?? '').toLowerCase();
      return (!!brand && lower.includes(brand)) || (!!model && lower.includes(model));
    });
    const unit = part ? firstAvailableUnit(stockUnits, part.id) : undefined;
    lines.push({
      category: baseCat,
      partId: part?.id ?? '',
      stockUnitId: unit?.id,
      quantity: 1,
      description: part ? describeAttributes(part.category, part.attributes) || part.name : `${baseCat} (pick a unit)`,
      note: part ? (unit ? undefined : 'No unit in stock — pick/add one') : 'No matching base unit in catalogue',
    });
  }

  // 2. RAM — e.g. "16GB RAM", "RAM: 8GB"
  const ramMatch = text.match(/(\d{1,3})\s?GB(?=\s*(?:ram|ddr|memory))|(?:ram|memory)[:\s]+(\d{1,3})\s?GB/i);
  const ramGb = ramMatch ? Number(ramMatch[1] || ramMatch[2]) : undefined;
  if (ramGb) {
    const part = findPart(parts, 'ram', (p) => Number(p.attributes.capacity) === ramGb);
    lines.push({
      category: 'ram', partId: part?.id ?? '', quantity: 1,
      description: part ? describeAttributes('ram', part.attributes) : `${ramGb}GB RAM`,
      note: part ? undefined : `${ramGb}GB RAM not in catalogue`,
    });
  }

  // 3. Storage — e.g. "512GB SSD", "1TB HDD", "256 GB NVMe"
  const storageMatch = text.match(/(\d{2,4})\s?(GB|TB)\s?(SSD|HDD|NVMe|M\.2)/i);
  if (storageMatch) {
    const cap = `${storageMatch[1]}${storageMatch[2].toUpperCase()}`;
    const type = storageMatch[3].toUpperCase();
    const part = findPart(parts, 'storage', (p) => String(p.attributes.capacity).toUpperCase().replace(/\s/g, '') === cap);
    lines.push({
      category: 'storage', partId: part?.id ?? '', quantity: 1,
      description: part ? describeAttributes('storage', part.attributes) : `${cap} ${type}`,
      note: part ? undefined : `${cap} ${type} not in catalogue`,
    });
  }

  return lines;
}
