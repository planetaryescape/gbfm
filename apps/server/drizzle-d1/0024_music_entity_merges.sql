-- No receipt/entity/account FKs: redirects survive source and account deletion.
-- The owning backend clears only before_image at undo expiry, retaining redirect.
CREATE TABLE music_entity_merges (
  operation_id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_slug TEXT NOT NULL,
  before_image TEXT,
  after_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  undo_expires_at INTEGER NOT NULL,
  restored_at INTEGER,
  CHECK (length(operation_id) = 64),
  CHECK (entity_type IN ('artist','album','track','playlist','label')),
  CHECK (length(source_id) > 0 AND length(target_id) > 0 AND length(source_slug) > 0 AND source_id <> target_id),
  CHECK (before_image IS NULL OR (json_valid(before_image) AND length(CAST(before_image AS BLOB)) <= 262144)),
  CHECK (length(after_digest) = 64 AND after_digest NOT GLOB '*[^0-9a-f]*'),
  CHECK (typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 9007199254740991 AND typeof(undo_expires_at) = 'integer' AND undo_expires_at BETWEEN 0 AND 9007199254740991 AND undo_expires_at = created_at + 86400000 AND (restored_at IS NULL OR (typeof(restored_at) = 'integer' AND restored_at BETWEEN created_at AND 9007199254740991)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX music_entity_merges_active_source_uq ON music_entity_merges(entity_type,source_id) WHERE restored_at IS NULL;
--> statement-breakpoint
CREATE INDEX music_entity_merges_active_slug_idx ON music_entity_merges(entity_type,source_slug) WHERE restored_at IS NULL;
--> statement-breakpoint
CREATE INDEX music_entity_merges_cleanup_idx ON music_entity_merges(undo_expires_at) WHERE before_image IS NOT NULL;
