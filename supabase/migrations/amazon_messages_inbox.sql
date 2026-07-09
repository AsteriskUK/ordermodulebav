-- Amazon inbound buyer messages via the email relay bridge (SP-API has no
-- inbox API). Adds the fields needed to store received messages and reply to
-- the anonymised relay address. Idempotent — safe to re-run.
ALTER TABLE amazon_messages ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE amazon_messages ADD COLUMN IF NOT EXISTS reply_to_email TEXT;
ALTER TABLE amazon_messages ADD COLUMN IF NOT EXISTS email_message_id TEXT;

-- Dedup key for IMAP sync (multiple NULLs allowed for API-sent rows).
CREATE UNIQUE INDEX IF NOT EXISTS idx_amazon_messages_email_id ON amazon_messages(email_message_id);

-- action is meaningless for inbound emails.
ALTER TABLE amazon_messages ALTER COLUMN action DROP NOT NULL;
