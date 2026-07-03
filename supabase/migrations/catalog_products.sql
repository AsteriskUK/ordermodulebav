-- ============================================================================
-- PRODUCT CATALOG (reference spec library)  — additive, idempotent
-- ----------------------------------------------------------------------------
-- A browsable library of known products (scraped from PcPartPicker, etc.).
-- This is REFERENCE DATA, distinct from physical inventory:
--   catalog_products  = "what a product IS" (specs, image, MSRP) — one row per model
--   inventory_parts   = "what we STOCK"      (SKU, tracking, thresholds)
--   stock_units / stock_levels = "what we physically HAVE" (qty on hand)
--
-- Goods-inward can search this catalog, pick a product, and spin up an
-- inventory_parts row pre-filled with clean specs + image. Category-specific
-- attributes live in `specs` JSONB, so new categories (GPU, storage, board,
-- PSU, ...) need NO schema change — just import more rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS catalog_products (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source        TEXT NOT NULL DEFAULT 'pcpartpicker',  -- where it was scraped from
  category      TEXT NOT NULL,                          -- cpu | memory | gpu | storage | motherboard | psu | case | cooler | ...
  name          TEXT NOT NULL,                          -- cleaned model name, e.g. "AMD Ryzen 7 9800X3D"
  brand         TEXT,                                   -- first token of name, e.g. "AMD", "Corsair"
  image_url     TEXT,
  source_url    TEXT,                                   -- original listing / category URL
  msrp          NUMERIC,                                -- cleaned price (nullable; some scrapes only show "Add")
  currency      TEXT DEFAULT 'GBP',
  rating_count  INTEGER,                                -- number of reviews, from "(439)"
  specs         JSONB NOT NULL DEFAULT '{}'::jsonb,     -- category-specific cleaned attributes
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  -- Dedupe key: one row per (source, category, name). Lets re-imports upsert
  -- rather than duplicate as you re-scrape / add more files.
  fingerprint   TEXT GENERATED ALWAYS AS (lower(source || '|' || category || '|' || name)) STORED,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_catalog_products_fingerprint ON catalog_products(fingerprint);
CREATE INDEX IF NOT EXISTS idx_catalog_products_category ON catalog_products(category);
CREATE INDEX IF NOT EXISTS idx_catalog_products_brand    ON catalog_products(brand);
-- Fuzzy search on name (pg_trgm already enabled for orders search).
CREATE INDEX IF NOT EXISTS idx_catalog_products_name_trgm ON catalog_products USING gin (name gin_trgm_ops);
-- Query by any spec field, e.g. specs @> '{"type":"DDR5"}'.
CREATE INDEX IF NOT EXISTS idx_catalog_products_specs ON catalog_products USING gin (specs);

-- Link a stocked part back to its catalog definition (optional) + carry its image.
ALTER TABLE inventory_parts ADD COLUMN IF NOT EXISTS catalog_product_id UUID REFERENCES catalog_products(id);
ALTER TABLE inventory_parts ADD COLUMN IF NOT EXISTS image_url TEXT;
CREATE INDEX IF NOT EXISTS idx_inventory_parts_catalog ON inventory_parts(catalog_product_id);

-- keep updated_at fresh (reuses the shared trigger fn from schema.sql)
CREATE OR REPLACE TRIGGER update_catalog_products_updated_at
  BEFORE UPDATE ON catalog_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: same "Allow all" pattern as the rest of the app
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='catalog_products' AND policyname='Allow all') THEN
    EXECUTE 'ALTER TABLE catalog_products ENABLE ROW LEVEL SECURITY';
    CREATE POLICY "Allow all" ON catalog_products FOR ALL USING (true);
  END IF;
END $$;
