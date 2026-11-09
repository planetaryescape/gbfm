CREATE TABLE mcp_operations (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 64),
  actor_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  client_id TEXT,
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  attempt_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'complete', 'expired')),
  outcome TEXT,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 9007199168340991),
  expires_at INTEGER NOT NULL CHECK (typeof(expires_at) = 'integer' AND expires_at = created_at + 86400000),
  CONSTRAINT mcp_operation_winner CHECK (state <> 'complete' OR outcome IS NOT NULL),
  CHECK (outcome IS NULL OR (json_valid(outcome) AND length(CAST(outcome AS BLOB)) <= 65536)),
  CHECK ((state = 'expired' AND outcome IS NULL AND attempt_id IS NULL AND actor_id IS NULL AND client_id IS NULL)
    OR (state IN ('pending', 'complete') AND actor_id IS NOT NULL AND client_id IS NOT NULL AND attempt_id IS NOT NULL AND length(attempt_id) = 36))
);
--> statement-breakpoint
CREATE INDEX mcp_operations_expiry_idx ON mcp_operations(expires_at) WHERE state <> 'expired';
--> statement-breakpoint
CREATE INDEX mcp_operations_actor_idx ON mcp_operations(actor_id);
--> statement-breakpoint
CREATE INDEX mcp_operations_client_idx ON mcp_operations(client_id);
--> statement-breakpoint
CREATE TRIGGER mcp_operations_actor_delete BEFORE DELETE ON user BEGIN
  UPDATE mcp_operations SET actor_id = NULL, client_id = NULL, attempt_id = NULL,
    outcome = NULL, state = 'expired' WHERE actor_id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER mcp_operations_client_delete BEFORE DELETE ON oauth_client BEGIN
  UPDATE mcp_operations SET actor_id = NULL, client_id = NULL, attempt_id = NULL,
    outcome = NULL, state = 'expired' WHERE client_id = OLD.client_id;
END;
