-- 0.2.0: the dashboard shows when each API key was last used and its first characters.
ALTER TABLE api_keys ADD COLUMN prefix TEXT NOT NULL DEFAULT '';
ALTER TABLE api_keys ADD COLUMN last_used INTEGER;
CREATE INDEX upload_recent ON uploads(state,created);
