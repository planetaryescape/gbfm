# Bluesky retirement

The connection, sync, archive-import, background jobs and UI were removed in
[#347](https://github.com/planetaryescape/gbfm/pull/347). Existing imported posts
and historical storage were deliberately retained.

## Content inventory

On 2026-11-15, a read-only scan of all 212 posts returned by the public post API
found two tweets with stored Bluesky attribution. None of the published posts
contained `bluesky`, `bsky.app` or `at://` in their title, description or body.
This does not audit private drafts, orphaned source rows, or external-account
storage.

The WWW and mobile source trees had no remaining Bluesky-specific consumers.
The remaining application behavior was server-side provenance enrichment, a
management source filter, a deletion restriction, and an unused music-resolution
origin.

## Code-only cleanup

- Post and tweet reads no longer query or return `blueskySource`.
- The management API no longer declares the `source=bluesky|native` filter.
  Type, status, text search, pagination and ownership rules remain.
- New canonical music resolutions no longer accept `bluesky` as an origin.
  Existing stored origin strings are not rewritten.
- Historical attribution no longer prevents an otherwise authorized explicit
  post deletion. Other dependency and authorization guards remain. The existing
  foreign key sets the source row's `post_id` to null; it does not delete the
  historical source row.

These API removals are intentional. External clients relying on the optional
provenance field or source filter must stop using them.

## Preserved storage

No database migration, production data deletion or post-content rewrite is part
of this cleanup. `external-account.schema.ts` and the original D1 migration
definitions remain to describe retained historical tables. Existing hydration
and deletion tests retain fixtures for imported content and detached history.

Dropping historical tables or deleting their records needs a separate private
data inventory and explicit approval. Historical design and migration documents
may still mention the former integration; they are not active runtime wiring.
