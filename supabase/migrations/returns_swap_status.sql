-- Allow the new 'swap' status (replacement sent ahead of receiving the faulty item back).
-- Swap details (swap_return_method, return_tracking_number) live in the metadata JSONB,
-- so no new columns are needed.
alter table returns drop constraint if exists returns_status_check;
alter table returns add constraint returns_status_check
  check (status in ('pending', 'received', 'refunded', 'rejected', 'replacement', 'swap'));

-- schema.sql attaches the update_returns_updated_at trigger to this table but the
-- column was never created, so every UPDATE failed with 42703. Add it.
alter table returns add column if not exists updated_at timestamptz default now();
