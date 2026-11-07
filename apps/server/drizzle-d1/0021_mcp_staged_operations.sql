CREATE TABLE mcp_operation_artwork (
  operation_id TEXT PRIMARY KEY NOT NULL REFERENCES mcp_operations(id) ON DELETE RESTRICT,
  actor_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  client_id TEXT,
  disposition TEXT CHECK (disposition IN ('created','reused')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('artist','album','track','label','playlist')),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
  catalogue_revision INTEGER NOT NULL CHECK (typeof(catalogue_revision) = 'integer' AND catalogue_revision BETWEEN 0 AND 9007199254740990),
  source_identity_key TEXT,
  artwork_policy TEXT NOT NULL CHECK (artwork_policy IN ('required','best_effort')),
  phase TEXT NOT NULL CHECK (phase IN ('pending','uploading','association_pending','delivered','failed')),
  artifact TEXT CHECK (artifact IS NULL OR (json_valid(artifact) AND length(CAST(artifact AS BLOB)) <= 2048)),
  lease_attempt_id TEXT,
  lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (typeof(lease_generation) = 'integer' AND lease_generation BETWEEN 0 AND 9007199254740991),
  lease_expires_at INTEGER,
  associated_revision INTEGER,
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN ('access_denied','target_missing','stale_revision','source_unavailable','artifact_rejected')),
  retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0,1)),
  CONSTRAINT mcp_artwork_winner CHECK (associated_revision IS NULL OR (typeof(associated_revision) = 'integer' AND associated_revision = catalogue_revision + 1)),
  CHECK (phase <> 'delivered' OR associated_revision IS NOT NULL),
  CHECK ((lease_attempt_id IS NULL AND lease_expires_at IS NULL) OR (lease_attempt_id IS NOT NULL AND length(lease_attempt_id) = 36 AND typeof(lease_expires_at) = 'integer' AND lease_expires_at >= 0)),
  CHECK ((phase = 'failed' AND failure_code IS NOT NULL) OR (phase <> 'failed' AND failure_code IS NULL)),
  CHECK ((phase = 'pending' AND artifact IS NULL) OR (phase IN ('uploading','association_pending','delivered') AND artifact IS NOT NULL) OR phase = 'failed'),
  CHECK ((retired = 1 AND disposition IS NULL AND actor_id IS NULL AND client_id IS NULL AND source_identity_key IS NULL AND lease_attempt_id IS NULL AND lease_expires_at IS NULL) OR (retired = 0 AND disposition IS NOT NULL AND actor_id IS NOT NULL AND client_id IS NOT NULL AND source_identity_key IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX mcp_operation_artwork_recovery_idx ON mcp_operation_artwork(phase, lease_expires_at) WHERE retired = 0;
--> statement-breakpoint
CREATE TRIGGER mcp_artwork_immutable BEFORE UPDATE ON mcp_operation_artwork
WHEN NEW.operation_id IS NOT OLD.operation_id OR (NEW.disposition IS NOT OLD.disposition AND NEW.retired <> 1)
  OR NEW.entity_type IS NOT OLD.entity_type OR NEW.entity_id IS NOT OLD.entity_id
  OR NEW.catalogue_revision IS NOT OLD.catalogue_revision OR NEW.artwork_policy IS NOT OLD.artwork_policy
  OR (NEW.source_identity_key IS NOT OLD.source_identity_key AND NEW.retired <> 1)
  OR (OLD.artifact IS NOT NULL AND NEW.artifact IS NOT OLD.artifact)
  OR NEW.lease_generation < OLD.lease_generation OR NEW.retired < OLD.retired
  OR (OLD.phase IN ('delivered','failed') AND NEW.phase IS NOT OLD.phase)
BEGIN SELECT RAISE(ABORT, 'mcp_artwork_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER mcp_artwork_actor_delete BEFORE DELETE ON user BEGIN
  UPDATE mcp_operation_artwork SET retired = 1, disposition = NULL, actor_id = NULL, client_id = NULL, source_identity_key = NULL,
    lease_attempt_id = NULL, lease_expires_at = NULL,
    failure_code = CASE WHEN phase IN ('delivered','failed') THEN failure_code ELSE 'access_denied' END,
    phase = CASE WHEN phase IN ('delivered','failed') THEN phase ELSE 'failed' END
    WHERE actor_id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER mcp_artwork_client_delete BEFORE DELETE ON oauth_client BEGIN
  UPDATE mcp_operation_artwork SET retired = 1, disposition = NULL, actor_id = NULL, client_id = NULL, source_identity_key = NULL,
    lease_attempt_id = NULL, lease_expires_at = NULL,
    failure_code = CASE WHEN phase IN ('delivered','failed') THEN failure_code ELSE 'access_denied' END,
    phase = CASE WHEN phase IN ('delivered','failed') THEN phase ELSE 'failed' END
    WHERE client_id = OLD.client_id;
END;
