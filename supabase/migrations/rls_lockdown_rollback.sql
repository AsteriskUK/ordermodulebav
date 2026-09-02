-- ============================================================================
-- ROLLBACK for rls_lockdown_authenticated.sql
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor if the lockdown breaks something and you
-- need the app back immediately. It restores today's behaviour by re-adding a
-- permissive "Allow all" policy to every public table (anon included). RLS
-- stays enabled but is effectively open again — i.e. back to the pre-Phase-2
-- state. Safe to re-run.
-- ============================================================================

DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    FOR p IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "Allow all" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;
