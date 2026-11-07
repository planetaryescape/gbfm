-- Domain revisions are not receipts. All writers must use the owning atomic
-- command batch, including invalidation fanout and physical-attempt fencing.
ALTER TABLE music_artists ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE music_artists ADD COLUMN last_operation_id TEXT CHECK (last_operation_id IS NULL OR length(last_operation_id) = 36);
--> statement-breakpoint
ALTER TABLE music_albums ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE music_albums ADD COLUMN last_operation_id TEXT CHECK (last_operation_id IS NULL OR length(last_operation_id) = 36);
--> statement-breakpoint
ALTER TABLE music_tracks ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE music_tracks ADD COLUMN last_operation_id TEXT CHECK (last_operation_id IS NULL OR length(last_operation_id) = 36);
--> statement-breakpoint
ALTER TABLE music_labels ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE music_labels ADD COLUMN last_operation_id TEXT CHECK (last_operation_id IS NULL OR length(last_operation_id) = 36);
--> statement-breakpoint
ALTER TABLE saved_mixes ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE saved_mixes ADD COLUMN last_operation_id TEXT CHECK (last_operation_id IS NULL OR length(last_operation_id) = 36);
--> statement-breakpoint
ALTER TABLE listening_collections ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE listening_collections ADD COLUMN last_operation_id TEXT CHECK (last_operation_id IS NULL OR length(last_operation_id) = 36);
--> statement-breakpoint
ALTER TABLE posts ADD COLUMN last_operation_id TEXT CHECK (last_operation_id IS NULL OR length(last_operation_id) = 36);
--> statement-breakpoint
CREATE TABLE listener_membership_revisions (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991),
  last_transition_id TEXT DEFAULT NULL,
  CHECK ((revision = 0 AND last_transition_id IS NULL) OR (revision > 0 AND last_transition_id IS NOT NULL AND length(last_transition_id) = 36))
);
--> statement-breakpoint
ALTER TABLE music_reminder ADD COLUMN command_revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(command_revision) = 'integer' AND command_revision BETWEEN 1 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE music_reminder ADD COLUMN dispatch_state TEXT NOT NULL DEFAULT 'open' CHECK (dispatch_state IN ('open', 'fenced', 'accepted', 'cancelled'));
--> statement-breakpoint
ALTER TABLE music_reminder ADD COLUMN last_operation_id TEXT CHECK (last_operation_id IS NULL OR length(last_operation_id) = 36);
--> statement-breakpoint
-- NULL deliberately violates NOT NULL for inconsistent historical combinations,
-- aborting this migration batch instead of silently inventing delivery evidence.
-- Every historical unsent row is fenced: no durable negative send evidence exists.
UPDATE music_reminder SET dispatch_state = CASE
  WHEN is_sent = 1 AND status = 'sent' THEN 'accepted'
  WHEN is_sent = 0 AND status IN ('pending', 'processing', 'failed') THEN 'fenced'
  ELSE NULL END;
