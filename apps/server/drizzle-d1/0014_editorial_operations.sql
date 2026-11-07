CREATE TABLE editorial_operations (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
