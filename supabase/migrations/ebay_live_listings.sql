-- eBay live listings cache (Trading API GetSellerList -> local DB)
-- Keyed by SKU so it can later link to our internal inventory catalog.
CREATE TABLE IF NOT EXISTS ebay_live_listings (
  sku TEXT PRIMARY KEY,
  item_id TEXT,
  title TEXT,
  description TEXT,
  image_url TEXT,
  additional_images JSONB DEFAULT '[]'::jsonb,
  price NUMERIC,
  currency TEXT DEFAULT 'GBP',
  quantity INTEGER DEFAULT 0,
  condition TEXT,
  listing_status TEXT DEFAULT 'active',
  listing_type TEXT,
  category_id TEXT,
  category_name TEXT,
  listing_url TEXT,
  inventory_part_id UUID,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ebay_live_listings_item_id ON ebay_live_listings(item_id);
CREATE INDEX IF NOT EXISTS idx_ebay_live_listings_status ON ebay_live_listings(listing_status);

ALTER TABLE ebay_live_listings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ebay_live_listings' AND policyname='Allow all') THEN
    CREATE POLICY "Allow all" ON ebay_live_listings FOR ALL USING (true);
  END IF;
END $$;
