-- ============================================================================
-- RESTRICT app_settings — DO NOT APPLY UNTIL THE PREREQUISITE IS DONE
-- ----------------------------------------------------------------------------
-- PROBLEM
--   app_settings currently has an "Allow all" RLS policy, and the app reads it
--   with the anon key — which Next.js inlines into the client bundle served to
--   every browser. That makes these rows readable by anyone who opens devtools
--   on the deployed site:
--       ebay_refresh_token          (long-lived OAuth refresh token)
--       ebay_signing_key_private    (private signing key)
--       ebay_access_token, ebay_msg_access_token, ebay_analytics_token,
--       ebay_finances_token, ebay_listing_access_token, ebay_feedback_token
--
-- PREREQUISITE (must be completed first, or the app will break)
--   1. Copy the service-role key from Supabase → Project Settings → API.
--   2. Set SUPABASE_SERVICE_ROLE_KEY in the server environment (Netlify env
--      vars and .env.local). It must NOT have a NEXT_PUBLIC_ prefix.
--   3. Confirm every server route that reads/writes app_settings uses
--      getServiceClient() from src/lib/supabase-admin.ts rather than the
--      shared anon client.
--   4. Rotate the exposed credentials — they should be assumed compromised:
--      eBay refresh token + signing key at minimum.
--
-- THEN apply this migration.
--
-- EFFECT
--   Anon (browser) loses all access to app_settings. The service-role key
--   bypasses RLS, so server routes keep working. Client code that needs
--   non-secret config must go through an API route.
--
--   Note: this also blocks the browser from reading 'app_config' and
--   'access_control'. Both are already loaded via the client today, so serve
--   them from an API route before applying, or split them into their own
--   non-secret table with a read-only policy.
-- ============================================================================

-- Remove the blanket policy.
DROP POLICY IF EXISTS "Allow all" ON app_settings;

-- Keep RLS on with no permissive policy for anon/authenticated: with RLS
-- enabled and no matching policy, those roles are denied by default while the
-- service role continues to bypass RLS entirely.
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Verify afterwards (should return zero rows when run with the anon key):
--   select key from app_settings;
