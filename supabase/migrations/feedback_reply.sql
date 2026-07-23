-- Store the seller's public reply to a piece of eBay feedback.
-- Optional: the reply is posted to eBay regardless; these columns just let the
-- app show the reply on the feedback card and persist it across reloads.
alter table if exists public.ebay_feedback
  add column if not exists reply_text text,
  add column if not exists replied_at timestamptz;
