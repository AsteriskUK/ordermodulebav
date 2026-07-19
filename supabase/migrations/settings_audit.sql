-- Append-only audit of app settings changes: who changed which setting, from
-- what to what, and when. The settings document itself lives in
-- app_settings under the key 'app_config' (same pattern as access_control).
--
-- Writes are best-effort: if this table is missing, saves still succeed.
CREATE TABLE IF NOT EXISTS settings_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  setting_key TEXT NOT NULL,
  old_value TEXT,                    -- JSON-encoded; NULL = was at default
  new_value TEXT,                    -- JSON-encoded; NULL = reset to default
  changed_by_id TEXT,
  changed_by_name TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settings_audit_changed_at ON settings_audit(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_settings_audit_key ON settings_audit(setting_key);

-- RLS: match every other table — enable and allow all (the app uses the anon key).
ALTER TABLE settings_audit ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'settings_audit' AND policyname = 'Allow all') THEN
    CREATE POLICY "Allow all" ON settings_audit FOR ALL USING (true);
  END IF;
END $$;
