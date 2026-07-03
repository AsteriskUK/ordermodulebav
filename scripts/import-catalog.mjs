#!/usr/bin/env node
/**
 * Import a PcPartPicker scrape (CSV) into the catalog_products reference table.
 *
 *   node scripts/import-catalog.mjs <file.csv> [--category cpu] [--dry] [--limit N]
 *
 * - Auto-detects the category from the header when possible (cpu, memory).
 * - Cleans the scraper's mess: strips label prefixes ("Core Count8" -> "8",
 *   "SpeedDDR5-6000" -> "DDR5-6000"), £ prices, "(439)" ratings, picks the image.
 * - Upserts on (source, category, name) so re-running / adding files updates in
 *   place instead of duplicating.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY from .env.local
 * (RLS is "allow all", so the anon key can write).
 */
import { readFileSync } from 'node:fs';

// ---------- env ----------
function loadEnv() {
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* .env.local optional if vars already set */ }
}
loadEnv();

// ---------- tiny RFC4180 CSV parser (handles quoted fields with commas) ----------
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---------- cleaners ----------
const clean = (v) => (v == null ? '' : String(v).trim());
const stripPrefix = (v, label) => {
  v = clean(v);
  if (label && v.toLowerCase().startsWith(label.toLowerCase())) v = v.slice(label.length).trim();
  return v || null;
};
const money = (v) => { const m = clean(v).match(/£\s*([\d,]+\.?\d*)/); return m ? parseFloat(m[1].replace(/,/g, '')) : null; };
const ratingCount = (v) => { const m = clean(v).match(/^\((\d[\d,]*)\)$/); return m ? parseInt(m[1].replace(/,/g, ''), 10) : null; };
const isUrl = (v) => /^https?:\/\/\S+\.(jpg|jpeg|png|webp|gif)/i.test(clean(v));
const snake = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const brandOf = (name) => (clean(name).split(/\s+/)[0] || null);

// Non-spec columns: never treated as attributes.
const META_COLS = new Set(['web_scraper_order', 'web_scraper_start_url', 'pagination', 'name', 'name2', 'name3', 'name4', 'rating', 'price', 'price2', 'price3', 'price4']);

function detectCategory(header) {
  const h = new Set(header);
  if (h.has('core_count') && h.has('microarchitecture')) return 'cpu';
  if (h.has('cas_latency') && h.has('modules')) return 'memory';
  return null; // fall back to --category
}

// Per-category enrichers refine the generic specs into nicer keys.
const ENRICHERS = {
  cpu(specs) {
    if (specs.performance_core_clock) { specs.base_clock = specs.performance_core_clock; delete specs.performance_core_clock; }
    if (specs.performance_core_boost_clock) { specs.boost_clock = specs.performance_core_boost_clock; delete specs.performance_core_boost_clock; }
    if (specs.integrated_graphics) { specs.igpu = specs.integrated_graphics; delete specs.integrated_graphics; }
    if (specs.core_count) specs.core_count = parseInt(specs.core_count, 10) || specs.core_count;
    return specs;
  },
  memory(specs) {
    if (specs.speed) specs.type = String(specs.speed).split('-')[0]; // DDR5-6000 -> DDR5
    const m = clean(specs.modules).match(/(\d+)\s*x\s*(\d+)/i);       // "2 x 16GB" -> 32
    if (m) specs.capacity_gb = parseInt(m[1], 10) * parseInt(m[2], 10);
    if (specs.cas_latency) specs.cas_latency = parseInt(specs.cas_latency, 10) || specs.cas_latency;
    return specs;
  },
};

function buildRecord(header, cols, category, source) {
  const get = (name) => { const i = header.indexOf(name); return i >= 0 ? cols[i] : ''; };

  // name is always the first "name" column
  const name = clean(get('name'));
  if (!name) return null;

  // image + rating: scan every column (their position drifts per category)
  let image_url = null, rating_count = null, msrp = null;
  for (const v of cols) {
    if (!image_url && isUrl(v)) image_url = clean(v);
    if (rating_count == null) { const r = ratingCount(v); if (r != null) rating_count = r; }
    if (msrp == null) { const p = money(v); if (p != null) msrp = p; }
  }

  // specs: every "data" column that is NOT meta and NOT a bare-label leftover.
  const specs = {};
  header.forEach((colName, i) => {
    if (META_COLS.has(colName) || colName.endsWith('2')) return; // skip meta + sibling label cols
    const raw = clean(cols[i]);
    if (!raw) return;
    // The scraper leaves the bare label in the sibling "<col>2" column — use it to strip the prefix.
    const sibIdx = header.indexOf(colName + '2');
    const label = sibIdx >= 0 ? clean(cols[sibIdx]) : colName.replace(/_/g, ' ');
    const val = stripPrefix(raw, label);
    if (val != null) specs[snake(colName)] = val;
  });

  const enriched = ENRICHERS[category] ? ENRICHERS[category](specs) : specs;

  return {
    source,
    category,
    name,
    brand: brandOf(name),
    image_url,
    source_url: clean(get('web_scraper_start_url')) || null,
    msrp,
    currency: 'GBP',
    rating_count,
    specs: enriched,
    last_seen_at: new Date().toISOString(),
  };
}

// ---------- main ----------
async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const catOverride = (args[args.indexOf('--category') + 1] && args.includes('--category')) ? args[args.indexOf('--category') + 1] : null;
  const dry = args.includes('--dry');
  const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;
  const source = 'pcpartpicker';

  if (!file) { console.error('Usage: node scripts/import-catalog.mjs <file.csv> [--category cpu] [--dry] [--limit N]'); process.exit(1); }

  const rows = parseCSV(readFileSync(file, 'utf8')).filter((r) => r.some((c) => clean(c)));
  const header = rows.shift().map(clean);
  const category = catOverride || detectCategory(header);
  if (!category) { console.error('Could not auto-detect category. Re-run with --category <key>. Header:', header.join(',')); process.exit(1); }

  // De-dupe on the same key Postgres conflicts on (source|category|name). The
  // scrape repeats some models; upsert can't touch the same key twice per batch.
  const byKey = new Map();
  let dupes = 0;
  for (const cols of rows.slice(0, limitArg)) {
    const rec = buildRecord(header, cols, category, source);
    if (!rec) continue;
    const key = `${rec.source}|${rec.category}|${rec.name}`.toLowerCase();
    if (byKey.has(key)) dupes++;
    byKey.set(key, rec); // last occurrence wins
  }
  const records = [...byKey.values()];

  console.log(`Parsed ${records.length} unique "${category}" products from ${file}${dupes ? ` (${dupes} duplicate names collapsed)` : ''}`);
  console.log('Sample:', JSON.stringify(records[0], null, 2));

  if (dry) { console.log('\n--dry: nothing written.'); return; }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY'); process.exit(1); }

  // Upsert straight to PostgREST (avoids the supabase-js realtime/WebSocket dep on Node 18).
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/catalog_products?on_conflict=fingerprint`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };

  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(batch) });
    if (!res.ok) { console.error(`\nBatch ${i / BATCH + 1} failed (${res.status}):`, await res.text()); process.exit(1); }
    done += batch.length;
    process.stdout.write(`\rUpserted ${done}/${records.length}`);
  }
  console.log(`\nDone. ${done} "${category}" products in catalog_products.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
