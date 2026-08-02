-- Per-user message reply signature. Each staff member (esp. comms) can sign off
-- in their own name; falls back to the global signature (Settings → Messaging)
-- when blank. The app tolerates this column being absent, so applying it is safe
-- at any time and simply enables the feature.
alter table if exists public.users
  add column if not exists signature text;
