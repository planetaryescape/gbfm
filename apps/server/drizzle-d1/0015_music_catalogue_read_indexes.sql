CREATE INDEX `music_album_artists_artist_album_idx` ON `music_album_artists` (`artistId`,`albumId`);--> statement-breakpoint
CREATE INDEX `music_track_artists_artist_track_idx` ON `music_track_artists` (`artistId`,`trackId`);--> statement-breakpoint
CREATE INDEX `music_tracks_album_id_idx` ON `music_tracks` (`albumId`,`id`);--> statement-breakpoint
CREATE INDEX `music_tracks_album_number_id_idx` ON `music_tracks` (`albumId`,(`trackNumber` IS NULL),`trackNumber`,`id`);--> statement-breakpoint
DROP INDEX `music_label_artists_artist_id_idx`;--> statement-breakpoint
CREATE INDEX `music_label_artists_artist_id_idx` ON `music_label_artists` (`artist_id`,`label_id`);--> statement-breakpoint
DROP INDEX `music_label_albums_album_id_idx`;--> statement-breakpoint
CREATE INDEX `music_label_albums_album_id_idx` ON `music_label_albums` (`album_id`,`label_id`);--> statement-breakpoint
CREATE INDEX `music_artists_name_id_idx` ON `music_artists` (lower(`name`),`id`);--> statement-breakpoint
CREATE INDEX `music_labels_name_id_idx` ON `music_labels` (lower(`name`),`id`);--> statement-breakpoint
CREATE INDEX `music_albums_title_id_idx` ON `music_albums` (lower(`title`),`id`);--> statement-breakpoint
CREATE INDEX `music_tracks_title_id_idx` ON `music_tracks` (lower(`title`),`id`);
