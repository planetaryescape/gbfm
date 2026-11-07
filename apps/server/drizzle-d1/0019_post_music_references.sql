-- No inferred backfill: unmanaged legacy primary pairs remain in posts unchanged.
ALTER TABLE posts ADD COLUMN music_references_managed INTEGER NOT NULL DEFAULT 0
  CHECK (music_references_managed IN (0, 1));
--> statement-breakpoint
CREATE TABLE post_music_references (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position BETWEEN 0 AND 49),
  album_id TEXT REFERENCES music_albums(id) ON DELETE RESTRICT,
  track_id TEXT REFERENCES music_tracks(id) ON DELETE RESTRICT,
  playlist_id TEXT REFERENCES music_playlists(id) ON DELETE RESTRICT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  PRIMARY KEY (post_id, position),
  CHECK ((album_id IS NOT NULL) + (track_id IS NOT NULL) + (playlist_id IS NOT NULL) = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX post_music_references_album_uq ON post_music_references(post_id, album_id) WHERE album_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX post_music_references_track_uq ON post_music_references(post_id, track_id) WHERE track_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX post_music_references_playlist_uq ON post_music_references(post_id, playlist_id) WHERE playlist_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX post_music_references_primary_uq ON post_music_references(post_id) WHERE is_primary = 1;
