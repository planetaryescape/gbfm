CREATE TABLE editorial_operations (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX editorial_operations_actor_idx ON editorial_operations(actor_id);
--> statement-breakpoint
CREATE INDEX editorial_operations_expiry_idx ON editorial_operations(created_at) WHERE result IS NOT NULL;
