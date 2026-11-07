-- Historical creator rows have no physical operation evidence.
ALTER TABLE audio ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE audio ADD COLUMN last_operation_id TEXT
  CHECK (last_operation_id IS NULL OR length(last_operation_id) = 36);
--> statement-breakpoint
ALTER TABLE shows ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE shows ADD COLUMN last_operation_id TEXT
  CHECK (last_operation_id IS NULL OR length(last_operation_id) = 36);
