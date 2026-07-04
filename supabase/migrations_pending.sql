-- ============================================================================
-- Consolidated migrations for this session. All idempotent — safe to re-run.
-- Run once in the Supabase SQL editor to be fully in sync with the app.
-- ============================================================================

-- ---- Orders: allow 'two_day' + capture buyer/billing (GSP) via metadata ----
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_type_check
  CHECK (delivery_type IN ('standard', 'next_day', 'two_day', 'express', 'collection'));

-- ---- Fast search over 40k+ orders (Historical Orders page) ----
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_orders_item_title_trgm     ON orders USING gin (item_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_username_trgm ON orders USING gin (buyer_username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_name_trgm     ON orders USING gin (buyer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_srn_trgm            ON orders USING gin (sales_record_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_order_number_trgm   ON orders USING gin (order_number gin_trgm_ops);

-- ---- eBay messages: conversation + media + type + sender ----
ALTER TABLE ebay_messages ADD COLUMN IF NOT EXISTS conversation_id TEXT;
ALTER TABLE ebay_messages ADD COLUMN IF NOT EXISTS media_urls JSONB DEFAULT '[]'::jsonb;
ALTER TABLE ebay_messages ADD COLUMN IF NOT EXISTS conversation_type TEXT DEFAULT 'FROM_MEMBERS';
ALTER TABLE ebay_messages ADD COLUMN IF NOT EXISTS sender_username TEXT;
CREATE INDEX IF NOT EXISTS idx_ebay_messages_conversation_id ON ebay_messages(conversation_id);

-- ---- eBay listing cache (message thread listing image) ----
CREATE TABLE IF NOT EXISTS ebay_listings (
  item_id TEXT PRIMARY KEY, title TEXT, image_url TEXT,
  additional_images JSONB DEFAULT '[]'::jsonb, price NUMERIC, currency TEXT,
  web_url TEXT, fetched_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE ebay_listings ENABLE ROW LEVEL SECURITY;

-- ---- eBay feedback (negative-feedback monitor) ----
CREATE TABLE IF NOT EXISTS ebay_feedback (
  feedback_id TEXT PRIMARY KEY, comment_type TEXT, comment_text TEXT,
  listing_id TEXT, listing_title TEXT, price NUMERIC, currency TEXT,
  buyer_masked TEXT, entered_period TEXT, automated BOOLEAN DEFAULT false,
  state TEXT, ticket_id UUID, acknowledged BOOLEAN DEFAULT false,
  first_seen_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ebay_feedback_type ON ebay_feedback(comment_type);
CREATE INDEX IF NOT EXISTS idx_ebay_feedback_ack ON ebay_feedback(acknowledged);
ALTER TABLE ebay_feedback ENABLE ROW LEVEL SECURITY;

-- ---- missing_items (persisted; was browser-only) ----
CREATE TABLE IF NOT EXISTS missing_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id TEXT, sales_record_number TEXT, buyer_username TEXT, item_title TEXT,
  missing_parts JSONB DEFAULT '[]'::jsonb, notes TEXT, status TEXT DEFAULT 'pending',
  reported_at TIMESTAMPTZ DEFAULT NOW(), reported_by_user_id TEXT, reported_by_user_name TEXT,
  responsible_department TEXT, responsible_user_id TEXT, responsible_user_name TEXT, dispatch_order_id TEXT
);
ALTER TABLE missing_items ENABLE ROW LEVEL SECURITY;

-- ---- eBay live listings (synced from Trading API GetSellerList) ----
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

-- ---- RLS allow-all policies for the new tables ----
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ebay_listings','ebay_feedback','missing_items','ebay_live_listings'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='Allow all') THEN
      EXECUTE format('CREATE POLICY "Allow all" ON %I FOR ALL USING (true)', t);
    END IF;
  END LOOP;
END $$;

-- ---- Storage: public message-images bucket + policies ----
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('message-images','message-images',true,5242880,ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Allow public read message images') THEN
    CREATE POLICY "Allow public read message images" ON storage.objects FOR SELECT USING (bucket_id = 'message-images');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Allow all message image uploads') THEN
    CREATE POLICY "Allow all message image uploads" ON storage.objects FOR ALL USING (bucket_id = 'message-images') WITH CHECK (bucket_id = 'message-images');
  END IF;
END $$;
