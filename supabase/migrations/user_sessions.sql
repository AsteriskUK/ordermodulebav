-- One active login per user.
--
-- Each sign-in claims the user's single session row with a fresh session_id and
-- then heartbeats it. A device whose session_id no longer matches has been
-- superseded and signs itself out. A session that stops heartbeating goes stale
-- and can be claimed again, so a closed tab never strands anyone.
CREATE TABLE IF NOT EXISTS user_sessions (
  user_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,        -- random per sign-in; identifies the device
  device_label TEXT,               -- coarse UA hint, for the "signed in on…" message
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_last_seen ON user_sessions(last_seen_at DESC);

-- RLS on with no permissive policy: only the service role (used by /api/session)
-- can read or write. Sessions must not be forgeable from the browser.
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON user_sessions;
