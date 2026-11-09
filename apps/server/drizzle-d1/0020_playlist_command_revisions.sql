-- A column CHECK may reference existing columns. This validates populated
-- revisions during ADD and future revision updates even when the marker is NULL.
-- No table rebuild or implicit revision-increment/validation triggers are needed.
ALTER TABLE music_playlists ADD COLUMN last_operation_id TEXT
  CHECK (last_operation_id IS NULL OR length(last_operation_id) = 36)
  CHECK (typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991);
