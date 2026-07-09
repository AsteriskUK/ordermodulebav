-- Amazon buyer messages, mirroring the ebay_messages/backmarket_messages model.
-- SP-API has no buyer-message inbox, so every row is one of our sent (or failed)
-- templated messages; `action` records which SP-API message type was used.
CREATE TABLE IF NOT EXISTS amazon_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  amazon_order_id TEXT NOT NULL,      -- 3-7-7 Amazon order id (= our salesRecordNumber)
  action TEXT NOT NULL,               -- SP-API message type, e.g. unexpectedProblem
  message_text TEXT NOT NULL DEFAULT '',
  direction TEXT DEFAULT 'sent',      -- always 'sent' (no inbox API)
  status TEXT DEFAULT 'sent',         -- sent | failed
  buyer_name TEXT,
  item_title TEXT,
  sent_by_id TEXT,                    -- staff user id
  sent_by_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amazon_messages_order_id ON amazon_messages(amazon_order_id);
CREATE INDEX IF NOT EXISTS idx_amazon_messages_sent_at ON amazon_messages(sent_at DESC);

-- RLS: match every other table — enable and allow all (the app uses the anon key).
ALTER TABLE amazon_messages ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'amazon_messages' AND policyname = 'Allow all') THEN
    CREATE POLICY "Allow all" ON amazon_messages FOR ALL USING (true);
  END IF;
END $$;
