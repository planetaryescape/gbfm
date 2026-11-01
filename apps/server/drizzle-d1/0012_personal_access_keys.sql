CREATE TABLE personal_access_keys (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  issuance_request_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  environment TEXT NOT NULL CHECK (environment IN ('prod', 'dev')),
  scopes TEXT NOT NULL CHECK (json_valid(scopes) AND json_type(scopes) = 'array'),
  secret_hash TEXT NOT NULL CHECK (length(secret_hash) = 64),
  display_prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + 7776000000),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  last_used_at INTEGER CHECK (last_used_at IS NULL OR last_used_at >= created_at),
  rate_window_start INTEGER,
  rate_request_count INTEGER NOT NULL DEFAULT 0 CHECK (rate_request_count BETWEEN 0 AND 60),
  CHECK ((rate_window_start IS NULL AND rate_request_count = 0) OR (rate_window_start IS NOT NULL AND rate_request_count > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX personal_access_keys_hash_uq ON personal_access_keys(secret_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX personal_access_keys_issuance_uq ON personal_access_keys(owner_user_id, environment, issuance_request_id);
--> statement-breakpoint
CREATE INDEX personal_access_keys_owner_idx ON personal_access_keys(owner_user_id, environment, created_at);
