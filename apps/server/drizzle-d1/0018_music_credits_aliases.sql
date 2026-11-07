-- Empty additive fact tables: legacy billing/source names are not evidence.
CREATE TABLE music_recording_credits (
  id TEXT PRIMARY KEY NOT NULL,
  track_id TEXT REFERENCES music_tracks(id) ON DELETE CASCADE,
  album_id TEXT REFERENCES music_albums(id) ON DELETE CASCADE,
  artist_id TEXT REFERENCES music_artists(id) ON DELETE RESTRICT,
  credited_name TEXT NOT NULL,
  credited_name_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('performer', 'instrument', 'producer', 'engineer')),
  instrument TEXT,
  instrument_key TEXT NOT NULL,
  participant_key TEXT NOT NULL,
  display_order INTEGER NOT NULL CHECK (typeof(display_order) = 'integer' AND display_order >= 0),
  source_label TEXT NOT NULL,
  source_url TEXT,
  evidence_note TEXT,
  asserted_by_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  asserted_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK ((track_id IS NOT NULL) + (album_id IS NOT NULL) = 1),
  CHECK ((role = 'instrument' AND instrument IS NOT NULL AND length(trim(instrument)) > 0 AND length(instrument_key) > 0) OR (role != 'instrument' AND instrument IS NULL AND instrument_key = '')),
  CHECK (participant_key = CASE WHEN artist_id IS NOT NULL THEN 'artist:' || artist_id ELSE 'name:' || credited_name_key END),
  CHECK (length(trim(credited_name)) > 0 AND length(credited_name_key) > 0),
  CHECK (length(trim(source_label)) > 0 AND ((source_url IS NOT NULL AND length(trim(source_url)) > 0) OR (evidence_note IS NOT NULL AND length(trim(evidence_note)) > 0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX music_recording_credits_track_uq ON music_recording_credits(track_id, participant_key, role, instrument_key) WHERE track_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX music_recording_credits_album_uq ON music_recording_credits(album_id, participant_key, role, instrument_key) WHERE album_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX music_recording_credits_track_order_idx ON music_recording_credits(track_id, display_order, id);
--> statement-breakpoint
CREATE INDEX music_recording_credits_album_order_idx ON music_recording_credits(album_id, display_order, id);
--> statement-breakpoint
CREATE TABLE music_artist_aliases (
  id TEXT PRIMARY KEY NOT NULL,
  artist_id TEXT NOT NULL REFERENCES music_artists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  source_label TEXT NOT NULL,
  source_url TEXT,
  evidence_note TEXT,
  asserted_by_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  asserted_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (length(trim(name)) > 0 AND length(name_key) > 0),
  CHECK (length(trim(source_label)) > 0 AND ((source_url IS NOT NULL AND length(trim(source_url)) > 0) OR (evidence_note IS NOT NULL AND length(trim(evidence_note)) > 0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX music_artist_aliases_artist_name_uq ON music_artist_aliases(artist_id, name_key);
--> statement-breakpoint
CREATE INDEX music_artist_aliases_name_idx ON music_artist_aliases(name_key);
