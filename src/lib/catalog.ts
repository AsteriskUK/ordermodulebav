import { supabase } from './supabase-client';
import { CatalogProduct } from './types';

/**
 * Maps a reference-catalog category (PcPartPicker taxonomy) to the inventory
 * category key used by INVENTORY_CATEGORIES / goods-inward. Extend as more
 * catalog categories are scraped (gpu → gpu, storage → storage, ...).
 */
export const CATALOG_TO_INVENTORY_CATEGORY: Record<string, string> = {
  cpu: 'cpu',
  memory: 'ram',
  gpu: 'gpu',
  storage: 'storage',
  motherboard: 'motherboard',
  'power-supply': 'charger',
  psu: 'charger',
};

/** Inventory category key → catalog category, for pulling catalog options into a build slot. */
export const INVENTORY_TO_CATALOG_CATEGORY: Record<string, string> = {
  cpu: 'cpu',
  ram: 'memory',
  gpu: 'gpu',
  storage: 'storage',
  motherboard: 'motherboard',
  charger: 'power-supply',
};

function mapRow(p: Record<string, unknown>): CatalogProduct {
  return {
    id: p.id as string,
    source: (p.source as string) ?? 'pcpartpicker',
    category: p.category as string,
    name: p.name as string,
    brand: (p.brand as string) ?? undefined,
    imageUrl: (p.image_url as string) ?? undefined,
    sourceUrl: (p.source_url as string) ?? undefined,
    msrp: (p.msrp as number) ?? undefined,
    currency: (p.currency as string) ?? undefined,
    ratingCount: (p.rating_count as number) ?? undefined,
    specs: (p.specs as Record<string, string | number>) ?? {},
  };
}

/** Server-side fuzzy search over catalog_products (name ilike), newest/most-rated first. */
export async function searchCatalog(query: string, category?: string, limit = 15): Promise<CatalogProduct[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  let req = supabase
    .from('catalog_products')
    .select('id, source, category, name, brand, image_url, source_url, msrp, currency, rating_count, specs')
    .ilike('name', `%${q}%`)
    .order('rating_count', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (category) req = req.eq('category', category);
  const { data, error } = await req;
  if (error) { console.warn('[catalog] search failed (run migration?):', error.message); return []; }
  return (data ?? []).map(mapRow);
}

const CATALOG_SELECT = 'id, source, category, name, brand, image_url, source_url, msrp, currency, rating_count, specs';

/** One page of the catalog for the browser: filter by category + name, paginated. */
export async function fetchCatalogPage(opts: { q?: string; category?: string; page?: number; pageSize?: number }): Promise<{ rows: CatalogProduct[]; total: number }> {
  const { q = '', category, page = 0, pageSize = 50 } = opts;
  let req = supabase.from('catalog_products').select(CATALOG_SELECT, { count: 'exact' });
  if (q.trim().length >= 2) req = req.ilike('name', `%${q.trim()}%`);
  if (category && category !== 'all') req = req.eq('category', category);
  req = req.order('rating_count', { ascending: false, nullsFirst: false }).order('name').range(page * pageSize, page * pageSize + pageSize - 1);
  const { data, count, error } = await req;
  if (error) { console.warn('[catalog] page fetch failed (run migration?):', error.message); return { rows: [], total: 0 }; }
  return { rows: (data ?? []).map(mapRow), total: count ?? 0 };
}

/** Distinct categories present in the catalog (for the filter dropdown). */
export async function fetchCatalogCategories(): Promise<string[]> {
  const { data, error } = await supabase.from('catalog_products').select('category').order('category').limit(1000);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => r.category as string))];
}

/** Best-effort family parse from a CPU product name, matching inventory-config options. */
function parseCpuFamily(name: string): string {
  const n = name.toLowerCase();
  for (const f of ['core i9', 'core i7', 'core i5', 'core i3', 'ryzen 9', 'ryzen 7', 'ryzen 5', 'ryzen 3', 'xeon', 'pentium', 'celeron']) {
    if (n.includes(f)) return f.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return 'Other';
}

/**
 * Best-effort map of a catalog product's specs onto an inventory category's
 * attribute fields. Unmapped fields are left blank for the user to complete;
 * the full spec set always remains on the linked catalog_products row.
 */
export function catalogToAttributes(inventoryCategoryKey: string, p: CatalogProduct): Record<string, string> {
  const s = p.specs ?? {};
  const str = (v: unknown) => (v == null ? '' : String(v));
  switch (inventoryCategoryKey) {
    case 'cpu':
      return { brand: str(p.brand), family: parseCpuFamily(p.name), model: p.name };
    case 'ram':
      return {
        type: str(s.type),
        capacity: str(s.capacity_gb),
        form_factor: 'DIMM',
        speed: str(s.speed).replace(/^DDR\d-/i, ''), // "DDR5-6000" -> "6000"
      };
    case 'storage':
      return { capacity: str(s.capacity), type: str(s.type) };
    case 'gpu':
      return { brand: str(p.brand), model: p.name };
    default:
      return {};
  }
}
