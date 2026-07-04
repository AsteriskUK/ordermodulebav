-- BackMarket customer messages, mirroring the ebay_messages inbox model.
-- A BackMarket "Care Folder" (group) is the conversation/thread; each message is
-- one row. Direction is derived from the message initiator/kind on sync.
CREATE TABLE IF NOT EXISTS backmarket_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bm_message_id TEXT UNIQUE,          -- BackMarket message id (dedup on sync)
  group_id TEXT,                      -- Care Folder id = conversation/thread
  order_id TEXT,                      -- linked BackMarket order id (if any)
  direction TEXT DEFAULT 'received',  -- sent | received
  customer_name TEXT,
  subject TEXT,
  message_text TEXT NOT NULL DEFAULT '',
  media_urls JSONB DEFAULT '[]'::jsonb,
  kind TEXT,                          -- e.g. MERCHANT_TO_ALL
  is_informative BOOLEAN DEFAULT false,
  sent_by_id TEXT,                    -- staff user id (for our sent replies)
  sent_by_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'received'      -- sent | failed | unread | read
);

CREATE INDEX IF NOT EXISTS idx_backmarket_messages_group_id ON backmarket_messages(group_id);
CREATE INDEX IF NOT EXISTS idx_backmarket_messages_order_id ON backmarket_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_backmarket_messages_sent_at ON backmarket_messages(sent_at DESC);

-- RLS: match every other table — enable and allow all (the app uses the anon key).
ALTER TABLE backmarket_messages ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'backmarket_messages' AND policyname = 'Allow all') THEN
    CREATE POLICY "Allow all" ON backmarket_messages FOR ALL USING (true);
  END IF;
END $$;
