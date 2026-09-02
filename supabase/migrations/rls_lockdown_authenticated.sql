-- ============================================================================
-- PHASE 2 — RLS LOCKDOWN: deny the anon key, require an authenticated session
-- ----------------------------------------------------------------------------
-- THE HOLE THIS CLOSES
--   The NEXT_PUBLIC_SUPABASE_ANON_KEY is inlined into the client bundle and is
--   therefore public. Today every table has an "Allow all" policy, so anyone
--   with that key (i.e. anyone who opens the site) can read and write the whole
--   database directly, bypassing the app entirely. This replaces "Allow all"
--   with "only a signed-in (authenticated) user may touch data". After the
--   email-OTP login (Phase 1), the browser carries the user's JWT on every
--   Supabase call, so the app keeps working; the bare anon key now grants
--   nothing.
--
-- WHY THIS IS SAFE HERE (verified before writing this)
--   • Every server route uses the service-role key (getServiceClient), which
--     BYPASSES RLS — so sign-in, the session lock, cron, webhooks etc. are
--     unaffected. No server route uses the anon client.
--   • The browser uses ONE supabase-js client for both auth and data, so once a
--     user signs in it sends role=authenticated on every request (proven with a
--     minted user JWT against PostgREST).
--   • Storage (image-upload.ts) is not currently used, so storage.objects is
--     intentionally left untouched here.
--
-- SCOPE / RESIDUAL (deliberate, see follow-up below)
--   This grants any authenticated staff member full access to all data — the
--   threat model being closed is the ANONYMOUS outsider with the public key,
--   which this fully closes. Finer per-role/per-row rules and hiding the eBay
--   secrets in app_settings from authenticated browsers (restrict_app_settings_
--   rls.sql — needs the config-via-API refactor + token rotation first) remain
--   as later hardening.
--
-- ROLLBACK (instant, if anything misbehaves): see rls_lockdown_rollback.sql —
--   it re-adds a permissive policy so the app returns to today's behaviour.
--
-- Safe to re-run (idempotent).
-- ============================================================================

DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    -- 1) Drop every existing policy on the table (names vary: "Allow all",
    --    "Enable all access", etc.) so we start from a clean slate.
    FOR p IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    -- 2) Ensure RLS is on (default-deny once the permissive policy is gone).
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- 3) Allow signed-in users full access. anon (the public key with no
    --    session) matches no policy and is therefore denied.
    EXECUTE format(
      'CREATE POLICY "authenticated_all" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- VERIFY
--   • With the ANON key (no session): `select * from orders limit 1;` -> 0 rows.
--   • Signed in through the app: everything loads and saves as before.
--   • List policies:  select tablename, policyname, roles from pg_policies
--                     where schemaname='public' order by tablename;
-- ----------------------------------------------------------------------------
