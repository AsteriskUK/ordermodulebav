-- ============================================================
-- RUN THIS IN: Supabase Dashboard → SQL Editor → New query
-- Project: jgwyewkdddocvtrkssgx
-- Run the whole thing in one go.
-- ============================================================

-- 1) Settings change history (safe, additive)
CREATE TABLE IF NOT EXISTS settings_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  setting_key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by_id TEXT,
  changed_by_name TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_settings_audit_changed_at ON settings_audit(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_settings_audit_key ON settings_audit(setting_key);
ALTER TABLE settings_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='settings_audit' AND policyname='Allow all') THEN
    CREATE POLICY "Allow all" ON settings_audit FOR ALL USING (true);
  END IF;
END $$;

-- 2) One active login per user (service-role only — not browser readable)
CREATE TABLE IF NOT EXISTS user_sessions (
  user_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  device_label TEXT,
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_seen ON user_sessions(last_seen_at DESC);
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON user_sessions;

-- 3) THE SECURITY FIX — stop the browser reading marketplace credentials
--    Only run this once the Netlify deploy of commit 7e55e37 (or later) is live
--    and healthy, with SUPABASE_SERVICE_ROLE_KEY set there.
DROP POLICY IF EXISTS "Allow all" ON app_settings;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- 4) Verify: this should return 0 rows when run as anon, and the policy list
--    for app_settings should now be empty.
SELECT tablename, policyname FROM pg_policies
WHERE tablename IN ('app_settings','user_sessions','settings_audit')
ORDER BY tablename;
