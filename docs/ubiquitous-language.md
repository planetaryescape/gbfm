# Ubiquitous Language

A shared glossary for goosebumps.fm. Use these terms in code, UI copy, APIs, and conversations so the product stays grounded in the same mental model.

## How to read this

- **Term** — the word we use.
- **Meaning** — what it actually means in the system.
- **Also called** — aliases we accept or are moving away from.
- **Avoid** — terms that create confusion.
- **Used in** — tables, schemas, routes, or user-facing surfaces where the term appears.

---

## Product

### goosebumps.fm / GBFM
The music platform. Short form "GBFM" is fine for repo names, env vars, and internal tools. Use "goosebumps.fm" in user-facing copy and URLs.

- **Used in:** repo name, `packages/`, domain `goosebumps.fm`.

---

## Content

### Audio
A playable media file. The base content type for anything with an audio URL.

- **Meaning:** A row in `audio` with a `url`, `type`, and optional editorial `content`.
- **Types:**
  - **Mix** — a DJ mix or recorded set. The flagship content type.
  - **Track** — a single music track.
  - **Misc** — any other audio that is not a mix or track.
- **Used in:** `audio` table, `audio_type` enum, `/mixes/*` routes.
- **Avoid:** "song" (too narrow), "recording" (ambiguous).

### Mix
A single DJ mix or set. Always an `Audio` of type `mix`.

- **Meaning:** A long-form audio recording, usually with a tracklist and write-up.
- **Used in:** `audio.type = 'mix'`, `/mixes/$mixId`.
- **Avoid:** "podcast", "radio show" (a show is a series; a mix is a single piece of content).

### Show
A recurring series of mixes. DJs host shows on a schedule, and each release is an episode.

- **Meaning:** A row in `shows`. Think residency or radio show.
- **Also called:** Residency.
- **Used in:** `shows` table, `/shows/$showSlug`, `show_subscriptions`.
- **Avoid:** "Podcast" (different publishing model), "radio show" unless used descriptively.

### Episode
One release within a show. Always an `Audio` row linked to a `Show`.

- **Meaning:** A single mix that belongs to a show, ordered by `episode_number`.
- **Used in:** `audio.show_id`, `audio.episode_number`, `/shows/$showSlug/$episodeSlug`.
- **Avoid:** "Show" for the individual release. A show is the series; an episode is one entry.

### Post
Long-form editorial content.

- **Meaning:** A row in `posts` of type `post`. Has a title and full MDX content.
- **Used in:** `posts` table, `post_type` enum.

### Micro
A short post without a required title.

- **Meaning:** A row in `posts` of type `micro`. Used for quick shares or one-liners.
- **Used in:** `posts` table, `post_type` enum.

### Label
A music label with a profile, releases, and associated creators.

- **Meaning:** A row in `labels`. The platform is label-centric: labels connect listeners to artists and releases.
- **Used in:** `labels` table, `label_creators`, `/labels/$labelSlug`.

### Release
A musical release belonging to a label.

- **Meaning:** A row in `releases`. An album, EP, single, or compilation tied to a `label_id`.
- **Used in:** `releases` table, `/labels/$labelSlug/releases`.
- **Avoid:** "Album" unless you specifically mean an album-type release.

### Content (generic)
Any published or draft entity: audio, show, post/ micro, label, release.

- **Meaning:** Shared fields (`title`, `slug`, `content`, `draft`, `tags`, `thumbnail_url`, etc.) come from `defaultContentFields`.
- **Used in:** `defaultContentFields`, admin overview, content routes.

---

## Music Metadata

### Music Entity
An artist, album, track, or playlist stored independently of any streaming platform.

- **Meaning:** A generic concept covering the four types in the music metadata system.
- **Types:** `artist`, `album`, `track`, `playlist`.
- **Used in:** `music_entity_types`, `music_entity_links`.

### Artist
A music artist or act.

- **Meaning:** A row in `music_artists`. May have bio, image, genres, and platform links.
- **Used in:** `music_artists`, `music_album_artists`, `music_track_artists`.

### Album
A music album.

- **Meaning:** A row in `music_albums`. Types: LP, EP, single, compilation.
- **Used in:** `music_albums`, `music_album_artists`.

### Track
A single music recording.

- **Meaning:** A row in `music_tracks`. May belong to an album.
- **Used in:** `music_tracks`, `music_track_artists`, `music_playlist_tracks`.

### Playlist
A curated list of tracks.

- **Meaning:** A row in `music_playlists`. Can be imported from Spotify and enriched with links to other platforms.
- **Used in:** `music_playlists`, `music_playlist_tracks`.

### Label Affiliation
A factual, many-to-many relationship between labels and their rosters or catalogs: an artist may be affiliated with multiple labels, and an album may be issued by multiple labels. It is not an editorial recommendation; tracks inherit affiliation through their album, standalone labeled singles are represented as single-type albums, and playlists have no label affiliation.

- **Used in:** label roster and catalog relationships.
- **Avoid:** "Related entity", "featured entity", or using affiliation for editorial curation.

### Platform Link / Entity Link
A URL that links a music entity to a specific streaming or social platform.

- **Meaning:** A row in `music_entity_links`. One link per platform per entity.
- **Status:** `pending_review`, `verified`, `rejected`.
- **Used in:** `music_entity_links`, scraper services, admin review queue.
- **Avoid:** "Streaming link" (some platforms are social, not streaming).

### Scrape / Enrichment
Discovering platform links for a music entity from a seed URL or text identifiers.

- **Meaning:** The scraper service calls providers (Odesli, MusicBrainz, Firecrawl) to find links. Enrichment is the same idea applied after an import.
- **Used in:** `MusicLinkScraperService`, `POST /music/:entityType/:entityId/scrape`, playlist import.
- **Avoid:** "Crawl" (crawling implies broad discovery; scraping is targeted).

### Review Queue
Admin interface for verifying scraped platform links before they appear publicly.

- **Meaning:** Links start as `pending_review`. An admin verifies or rejects them.
- **Used in:** `GET /music/links/pending`, `PATCH /music/:entityType/:entityId/links/:linkId`.

---

## People

### User
Any registered account.

- **Meaning:** A row in `user`. Has email, name, role, bio, and social links.
- **Roles:** `user`, `editor`, `admin`.
- **Used in:** `user` table, auth routes, profiles.

### Creator
A user attached to a piece of content as an author, host, or label runner.

- **Meaning:** Junction rows like `audio_creators`, `post_creators`, `label_creators`, `show_creators`. A user can be a creator on many things.
- **Used in:** `*_creators` junction tables.
- **Avoid:** "Author" (too writer-specific), "Owner" (implies sole ownership).

### Host
A creator of a show.

- **Meaning:** A user listed in `show_creators` for a show.
- **Used in:** `show_creators`, show detail pages.

### Curator
A user who created a music playlist.

- **Meaning:** The `curator_id` on `music_playlists`.
- **Used in:** `music_playlists.curator_id`.

### Subscriber (Newsletter)
An email address subscribed to the newsletter.

- **Meaning:** A row in `newsletter_subscribers`. May or may not be linked to a user.
- **Used in:** `newsletter_subscribers`, subscribe endpoints.

### Subscriber (Show)
A user subscribed to a show to get notified about new episodes.

- **Meaning:** A row in `show_subscriptions`.
- **Used in:** `show_subscriptions`, `/shows/:showId/subscribe`.
- **Avoid:** "Follower" (different social connotation).

---

## Engagement

### Favorite
A user saving an audio item or show for later.

- **Meaning:** A row in `favorites`. Either `audio_id` or `show_id` is set.
- **Used in:** `favorites` table, `FavoriteButton`, `/favorites` routes.

### Play Count
Number of times an audio item has been played.

- **Meaning:** `audio.play_count`. Incremented by the audio player.
- **Used in:** `audio.play_count`, admin overview "top mixes".

### Music Reminder
A user-scheduled reminder to listen to a track later.

- **Meaning:** A row in `music_reminder`. Sends an email on the reminder date.
- **Used in:** `music_reminder`, `/reminders`.

---

## Publishing

### Draft
Content that is not yet publicly visible.

- **Meaning:** `draft = true`. Draft content does not appear in public listings.
- **Used in:** `draft` column on all content tables.
- **Opposite:** Published (`draft = false`).

### Published
Content that is publicly visible.

- **Meaning:** `draft = false`. Does not imply promotion or featuring.
- **Used in:** Admin overview, content listings.

### Slug
A URL-safe identifier for a content item.

- **Meaning:** Human-readable path segment, unique per content type.
- **Used in:** `slug` column on content tables, routes like `/mixes/:slug`.

### Content Field
One of the shared editorial fields defined in `defaultContentFields`.

- **Meaning:** `title`, `description`, `thumbnail_url`, `banner_image_url`, `slug`, `content`, `draft`, `tags`, plus audit timestamps.
- **Used in:** `defaultContentFields`, schema definitions.

### MDX Content
Editorial body content stored as MDX and compiled to HTML for rendering.

- **Meaning:** The `content` column on content tables, compiled to `compiledContent` by services.
- **Used in:** `content` fields, `Compiled*` schemas.

---

## Distribution & Operations

### Mix Processing
The local CLI pipeline that embeds metadata and artwork into audio files.

- **Meaning:** OpenSound's standalone `gbpm` CLI uses FFmpeg to produce MP3 or MP4 output from GBFM presets.
- **Used in:** `tools/process-mix/` branding and job files; the external `gbpm` CLI.

### Email Delivery Log
A record of every email sent or attempted.

- **Meaning:** A row in `email_delivery_logs` with status and SES metadata.
- **Used in:** `email_delivery_logs`, admin overview.

### Email Preference
User-level settings for receiving emails.

- **Meaning:** A row in `user_email_preferences`. Controls mix release, promotional, and system emails.
- **Used in:** `user_email_preferences`.

### Social Link
A user's linked profile on an external platform.

- **Meaning:** A row in `user_social_links`. Platforms: Bandcamp, Substack, SoundCloud, Instagram, Twitter, TikTok.
- **Used in:** `user_social_links`, user profiles.

### Admin Overview
The admin dashboard showing product health, publishing pulse, community, and operations.

- **Meaning:** Read-only aggregation at `/admin/overview`.
- **Used in:** `adminOverviewResponseSchema`, `/admin/overview` route.

---

## Terms to avoid

| Avoid | Use instead | Why |
| --- | --- | --- |
| Song | Track or Mix | "Song" implies a vocal composition. We also host instrumentals and DJ mixes. |
| Recording | Audio / Mix / Track | Too broad and clinical. |
| Podcast | Show / Mix | Different content model. |
| Radio show | Show (or residency) | Our shows are on-demand series, not live broadcasts. |
| Album | Release (unless music metadata) | In the content system, a release can be an EP or single. |
| Author | Creator | We have audio, labels, and shows, not just writing. |
| Follower | Subscriber (for shows) / Favorite (for content) | We do not have a follow model. |
| Streaming link | Platform link | Some links are to social platforms, not streaming services. |

---

## Adding or changing terms

1. Propose the change here first.
2. Update code, schemas, and API names to match.
3. Update UI copy so users see the same word.
4. Keep this file version-controlled as the source of truth.
