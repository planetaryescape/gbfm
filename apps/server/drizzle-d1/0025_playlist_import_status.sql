-- Specialized progress/outbox attached to the one common receipt, not a ledger.
-- No playlist FK: guarded deletion retires and clears resumable state first.
CREATE TABLE playlist_import_statuses (
  operation_id TEXT PRIMARY KEY NOT NULL REFERENCES mcp_operations(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL CHECK (instr(client_id, char(0)) = 0 AND length(client_id) BETWEEN 1 AND 256),
  resource TEXT NOT NULL CHECK (instr(resource, char(0)) = 0 AND length(resource) BETWEEN 1 AND 2048),
  playlist_id TEXT,
  playlist_revision INTEGER,
  phase TEXT NOT NULL CHECK (phase IN ('importing','enrichment_pending','enriching','completed','partial','failed','interrupted','retired')),
  imported_processed INTEGER NOT NULL DEFAULT 0 CHECK (typeof(imported_processed) = 'integer' AND imported_processed BETWEEN 0 AND 9007199254740991),
  import_failed INTEGER NOT NULL DEFAULT 0 CHECK (typeof(import_failed) = 'integer' AND import_failed BETWEEN 0 AND imported_processed),
  enrichment_processed INTEGER NOT NULL DEFAULT 0 CHECK (typeof(enrichment_processed) = 'integer' AND enrichment_processed BETWEEN 0 AND 9007199254740991),
  enrichment_failed INTEGER NOT NULL DEFAULT 0 CHECK (typeof(enrichment_failed) = 'integer' AND enrichment_failed BETWEEN 0 AND enrichment_processed),
  imported_total INTEGER CHECK (imported_total IS NULL OR (typeof(imported_total) = 'integer' AND imported_total BETWEEN imported_processed AND 9007199254740991)),
  enrichment_total INTEGER CHECK (enrichment_total IS NULL OR (typeof(enrichment_total) = 'integer' AND enrichment_total BETWEEN enrichment_processed AND 9007199254740991)),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN ('provider_unavailable','source_changed','authority_denied','target_changed','status_unavailable','interrupted')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991),
  last_attempt_id TEXT CHECK (last_attempt_id IS NULL OR length(last_attempt_id) = 36),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at BETWEEN created_at AND 9007199254740991),
  terminal_at INTEGER CHECK (terminal_at IS NULL OR (typeof(terminal_at) = 'integer' AND terminal_at BETWEEN created_at AND 9007199254740991)),
  dispatch_state TEXT NOT NULL DEFAULT 'none' CHECK (dispatch_state IN ('none','pending','sent')),
  dispatch_attempts INTEGER NOT NULL DEFAULT 0 CHECK (typeof(dispatch_attempts) = 'integer' AND dispatch_attempts BETWEEN 0 AND 9007199254740991),
  next_dispatch_at INTEGER CHECK (next_dispatch_at IS NULL OR (typeof(next_dispatch_at) = 'integer' AND next_dispatch_at BETWEEN 0 AND 9007199254740991)),
  dispatched_at INTEGER CHECK (dispatched_at IS NULL OR (typeof(dispatched_at) = 'integer' AND dispatched_at BETWEEN 0 AND 9007199254740991)),
  attempt_id TEXT CHECK (attempt_id IS NULL OR length(attempt_id) = 36),
  generation INTEGER NOT NULL DEFAULT 0 CHECK (typeof(generation) = 'integer' AND generation BETWEEN 0 AND 9007199254740991),
  lease_until INTEGER CHECK (lease_until IS NULL OR (typeof(lease_until) = 'integer' AND lease_until BETWEEN 0 AND 9007199254740991)),
  cursor_position INTEGER CHECK (cursor_position IS NULL OR (typeof(cursor_position) = 'integer' AND cursor_position BETWEEN 0 AND 9007199254740991)),
  cursor_track_id TEXT CHECK (cursor_track_id IS NULL OR length(cursor_track_id) = 36),
  CHECK ((playlist_id IS NULL AND playlist_revision IS NULL) OR (playlist_id IS NOT NULL AND playlist_revision IS NOT NULL AND typeof(playlist_revision) = 'integer' AND playlist_revision BETWEEN 0 AND 9007199254740991)),
  CHECK (phase NOT IN ('enrichment_pending','enriching') OR playlist_id IS NOT NULL),
  CHECK ((cursor_position IS NULL AND cursor_track_id IS NULL) OR (phase = 'enriching' AND cursor_position IS NOT NULL AND cursor_track_id IS NOT NULL)),
  CHECK ((phase IN ('completed','partial','failed','interrupted','retired')) = (terminal_at IS NOT NULL)),
  CHECK (phase <> 'completed' OR (imported_total IS NOT NULL AND imported_processed = imported_total AND import_failed = 0 AND enrichment_total IS NOT NULL AND enrichment_processed = enrichment_total AND enrichment_failed = 0)),
  CHECK (phase <> 'partial' OR (imported_total IS NOT NULL AND imported_processed = imported_total AND import_failed = 0 AND enrichment_total IS NOT NULL AND enrichment_failed > 0)),
  CHECK ((phase IN ('importing','enriching') AND attempt_id IS NOT NULL AND lease_until IS NOT NULL AND generation >= 1) OR (phase NOT IN ('importing','enriching') AND attempt_id IS NULL AND lease_until IS NULL)),
  CHECK (phase <> 'importing' OR generation = 1),
  CHECK ((dispatch_state = 'none' AND next_dispatch_at IS NULL AND dispatched_at IS NULL) OR (dispatch_state = 'pending' AND phase = 'enrichment_pending' AND next_dispatch_at IS NOT NULL AND dispatched_at IS NULL) OR (dispatch_state = 'sent' AND phase IN ('enrichment_pending','enriching') AND next_dispatch_at IS NULL AND dispatched_at IS NOT NULL)),
  CHECK ((phase = 'enrichment_pending' AND dispatch_state IN ('pending','sent')) OR (phase = 'enriching' AND dispatch_state = 'sent') OR (phase NOT IN ('enrichment_pending','enriching') AND dispatch_state = 'none'))
);
--> statement-breakpoint
CREATE INDEX playlist_import_statuses_actor_idx ON playlist_import_statuses(actor_id,created_at,operation_id);
--> statement-breakpoint
CREATE INDEX playlist_import_statuses_dispatch_idx ON playlist_import_statuses(dispatch_state,next_dispatch_at,operation_id);
