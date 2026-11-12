---
name: gbfm-editorial
description: Author and repair GBFM editorial drafts and music research notes using native Goosebumps music entities. Use when saving listening notes, converting Spotify links or record lists into music cards, importing missing records, adding media, or checking editorial previews. Prevents provider iframe substitutions, unresolved cards, duplicate imports, accidental publication, and false verification claims.
---

# GBFM editorial

Music discussed in a post belongs in the GBFM catalog. Spotify URLs are import inputs or listening links, not a substitute for native music entities.

## Preserve the draft

1. Read the latest saved post and inspect the browser for unsaved user edits before changing anything. Record the post ID and current version or update timestamp.
2. Preserve memories, qualifications, exclusions, links to exact performances, and separate research threads. Do not invent personal opinions, dates, identities, or an article arc.
3. Save edits as an unpublished draft. Do not publish the post, catalog entries, or a private playlist as a side effect.
4. Obtain approval before production imports unless the current request explicitly authorizes them. Explain their scope. Never change a database schema or use ad hoc SQL to bypass catalog invariants.

## Resolve music before writing cards

1. Inventory each record's title, artist, entity type, and exact source URL. Separate confirmed selections from browsing prompts.
2. Reuse existing canonical GBFM identities. Inspect the current API and import implementation instead of guessing tools, routes, fields, or IDs.
3. Import missing entities through the existing authenticated catalog flow. In the current API, `POST /api/music/resolve` accepts `{ "url": "...", "origin": "editorial" }` and returns the canonical entity, verified links, and delivered artwork.
4. Verify title, artist, entity type, GBFM ID, artwork, and verified source links. Keep an import receipt mapping source URLs to GBFM IDs. Confirm the exact release or recording, not just a similar title.
5. A timeout is an unknown outcome. Inspect persisted entities and request state before retrying. Retain results from long-running operations; do not repeatedly submit imports or abandon successful imports because a browser tool timed out.
6. Do not manufacture a catalog entry from a guessed match, attach an unverified source, weaken authorization, or silently replace a failed import with a provider iframe. Report the specific blocker and preserve the original research reference until it is resolved.

## Use native entity directives

Use GBFM IDs, not Spotify IDs, in these directives:

```md
::album{id="GBFM_ALBUM_ID" tracks="false"}

::track{id="GBFM_TRACK_ID"}

:::cards
::track{id="GBFM_TRACK_ID"}
::album{id="GBFM_ALBUM_ID" tracks="false"}
:::
```

- `::music{type="album" id="GBFM_ALBUM_ID" tracks="false"}` is also supported. Check `packages/rich-content/src/source.ts` for the installed grammar.
- Do not use `::media{url="https://open.spotify.com/..."}` for records or playlists. A provider listening link within a GBFM card is expected; a Spotify iframe is not a GBFM entity.
- Keep album track lists collapsed or disabled when they would overwhelm listening notes.
- Inspect `packages/rich-content/src/limits.ts` before converting a large research pool. Do not silently truncate it, arbitrarily choose a canon, or raise limits to fit a single note. Agree on grouping or splitting when necessary.
- For playlists, verify visibility and completeness. Do not publish a private research pile, import only a prefix, or present an empty metadata shell as a fully imported playlist. Read current playlist API and renderer visibility rules first.

## Treat external performances separately

- An exact live video is not interchangeable with an album recording. Preserve its source and attribution even when the corresponding album has a native card.
- Use `::media{url="..."}` only for deliberately external media, such as that exact YouTube performance, and verify that the player actually displays usable content.
- For a blocked, unavailable, or non-embeddable video, use an honestly labelled linked thumbnail or source link instead of leaving a blank iframe. Do not bypass provider anti-abuse checks or relax security headers.

## Verify the actual preview

1. Render the candidate content and inspect diagnostics before saving. Every native card must resolve to the intended GBFM entity, with no unavailable placeholders.
2. Inspect the visible preview, including images and player content. DOM presence, an HTTP 200, or an iframe URL alone does not prove success. Scroll to the changed records and capture real screenshots.
3. Check that there are no Spotify iframes, broken images, blank video panels, unintended track lists, or missing research sections. Use frame and network inspection to distinguish provider failure from GBFM rendering failure.
4. Save once with the latest concurrency token, then read back or reopen the saved draft and recheck the preview. Do not overwrite newer browser edits.
5. Report precisely what is complete and what is blocked. Do not call the draft fixed while knowingly leaving broken embeds, unresolved cards, or unfinished imports.

## Code changes

Read `FOLDKIT.md` and the installed framework version before changing WWW. Use `gbfm-images` for artwork delivery changes. Follow the repo's test instructions, including `bun precommit`; draft edits alone do not justify unrelated UI changes or a deployment.
