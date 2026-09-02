-- ============================================================================
-- HARDEN app_settings — hide marketplace secrets from signed-in browsers
-- ----------------------------------------------------------------------------
-- Run AFTER rls_lockdown_authenticated.sql.
--
-- WHAT THIS CLOSES
--   app_settings holds the marketplace credentials —
--       ebay_refresh_token, ebay_signing_key_private, ebay_access_token,
--       ebay_msg_access_token, ebay_analytics_token, ebay_finances_token,
--       ebay_listing_access_token, ebay_feedback_token, ebay_app_access_token,
--       amazon/backmarket tokens, etc.
--   After the Phase-2 lockdown these are no longer readable by the anon key, but
--   a *signed-in* staff browser (authenticated) could still read them. Every
--   part of the app that legitimately uses a token does so through a server API
--   route (service-role) — the browser never needs one. So we remove the
--   browser's access to app_settings entirely, with a single exception.
--
-- THE ONE EXCEPTION
--   The auto-pull hook (src/hooks/use-auto-pull.ts, 'use client') reads/writes a
--   non-secret coordination timestamp under key 'auto_pull_last_run'. It is the
--   only key the browser touches directly, so the policy below allow-lists that
--   key and nothing else. The list is an ALLOW-list — it fails closed, so any
--   secret (existing or added later) stays service-role-only by default.
--
-- The service-role key (server API routes) bypasses RLS and keeps full access.
--
-- Safe to re-run.
-- ============================================================================

-- Replace the broad "authenticated can do anything" policy (from the Phase-2
-- lockdown) with a narrow allow-list, for app_settings only.
DROP POLICY IF EXISTS "authenticated_all" ON app_settings;
DROP POLICY IF EXISTS "app_settings_non_secret" ON app_settings;

CREATE POLICY "app_settings_non_secret" ON app_settings
  FOR ALL TO authenticated
  USING (key IN ('auto_pull_last_run'))
  WITH CHECK (key IN ('auto_pull_last_run'));

-- ----------------------------------------------------------------------------
-- VERIFY (signed in through the app / with a user JWT):
--   select value from app_settings where key = 'ebay_refresh_token';  -> 0 rows
--   select value from app_settings where key = 'auto_pull_last_run';  -> 1 row
-- Server routes (service-role) continue to read every key.
-- ----------------------------------------------------------------------------
-- ROLLBACK (revert app_settings to the Phase-2 authenticated-full policy):
--   DROP POLICY IF EXISTS "app_settings_non_secret" ON app_settings;
--   CREATE POLICY "authenticated_all" ON app_settings
--     FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- ----------------------------------------------------------------------------
