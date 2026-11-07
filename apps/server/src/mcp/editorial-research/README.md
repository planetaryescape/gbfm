# E2 evidence and explicit editorial context (#531)

This module implements all nine selected handlers on P1's named cumulative base
`b1b3345d92bb1455f1e942c21e9b361d7a394073`. It does not close #531: independent
updated-head review and central registration/discovery remain integration gates.

| Tool | Input | Observable result |
| --- | --- | --- |
| `get_music_coverage` | entityType/entityId, limit | Published editorial references to that exact eligible identity |
| `find_related_editorials` | entityType/entityId, limit | Public structured references to the seed and its bounded same-kind catalogue relatives |
| `explore_genre` | genreId, limit | Direct recorded genre membership; no inherited genres |
| `explore_label` | labelId, limit | Published label plus recorded published artist/album affiliations |
| `find_artist_collaborations` | artistId, limit | Shared recorded artist credits on sampled published releases, not a historical claim |
| `find_undercovered_music` | 1..20 selected entities | Sampled public reference counts per selected identity, never catalogue-wide absence |
| `get_music_research_sources` | entityType/entityId, limit | Verified safe stored links, never remote contents |
| `get_draft_music_context` | postId, expectedVersion? | One owned unpublished editorial; coherent source version and recorded references |
| `get_editorial_context` | postId, expectedVersion? | Explicit public editorial or caller-authored draft; no draft search |

The seven public reads require live `catalogue:read` **and** `content:read`, including
their discovery annotations. `posts:read` is not a substitute. No private drafts,
creators, provenance blobs, label bodies, provider calls, writes or notifications
are returned or performed. Inputs reject excess fields. Default example limit is
10, maximum 20; sources default to 20. Undercoverage samples at most 200 references.
Music inputs are explicit artist/album/track/music-label IDs, not URLs or names.

Draft music context requires `posts:read` + `catalogue:read`. Editorial context
requires the public scopes above, plus `posts:read` for a caller-authored draft.
Both reuse E1's coherent snapshot and full `projectPost` version. Other-owner drafts
and micro posts fail closed; stale expected versions conflict. The source projection
contains at most 8,000 UTF-16 units, title 200, description 1,000 and 20 tags of 100
characters, with source/tag truncation flags. The version covers full source, not
the clipped text. No creator IDs are disclosed. Stored references remain ordered;
album/track display uses strict evidence qualification, playlist display uses PL1's
captured-time public predicate in one bounded query. No reference is resolved by name
or URL. Ineligible target display is explicit and is not negative evidence.

Every successful tool now requires the request's actual `CommandAuthority` checkpoint
before disclosure. Context also checkpoints before reading the explicit source.
There is no injected-principal-only production fallback. Request authority is resolved
at execution, not captured while constructing shared layers.

Music evidence requires non-null publication no later than the request's captured
clock. A genre label has no publication field and qualifies through eligible
endpoints. `musicLabel` in `entity_labels` maps to wire kind `label`; this is not
the music-label affiliation relation. Tracks do not inherit album genre or
coverage. Missing metadata is unknown, not negative evidence.

Public references read all typed `post_music_references` rows. Only unmanaged
posts with zero stored rows use their legacy pair. Managed empty never falls
back. Candidate posts must be `draft=0`, `type=post`; target publication is checked
again in the coverage query. Other-user drafts never enter samples or counts.

Each returned assertion has a source locator, observation time and SHA-256
fingerprint of its projected values. Fingerprints are immutable identifiers of
the returned assertion, not durable evidence handles or claims about URL contents.
Names and titles are at most 200 characters. All source text is untrusted.

`EditorialEvidenceStore.open(now)` is the shared E2/R2 request-local read seam.
It parses persisted rows, allows at most 14 evidence SQL statements and 400 fetched
records. Request-authority checkpoints execute additional credential SQL; explicit
context and playlist reads also use their source snapshot seams. Continuation tests
count the combined SQL against 16 statements for the tested calls; the evidence-reader
counter alone is not a whole-request SQL limit. Calls have a five-second response
deadline. Tool output includes the compatibility text copy in a 64 KiB
budget, with 512 bytes reserved for result flags. Overflow fails `unavailable`;
it never silently truncates a result to fit. A D1 read already in progress is not
claimed to be cancelled by this response deadline.

Related discovery retains at most 50 eligible seed edges per relation kind and
200 visible candidates plus a sentinel. Publication filters precede candidate
caps, so hidden rows cannot consume the visible window. This bounds admitted
rows, not arbitrary database fanout, stored-value bytes or sort CPU. Actual D1
`EXPLAIN QUERY PLAN` inspection found and removed four-table materialization in
recommendation discovery; the tested track path uses album, artist reverse and
genre indexes plus entity primary-key lookups. No universal scan/latency bound is
claimed for all catalogue sizes.

## Integration and verification

Exports: `EditorialResearchToolkit`, `EditorialResearchHandlersLayer`,
`EditorialResearchServiceLayer`, `EditorialContextServiceLayer`; service layers require `Database` and
`EditorialMcpConfig`. P1 owns registry, persisted OAuth policy and discovery.
No central registration or production scope policy is changed here.

Run from `apps/server`:

```sh
bunx vitest run --config vitest.d1.config.ts src/mcp/editorial-research/research.d1.test.ts
bunx vitest run --config vitest.d1.config.ts src/mcp/editorial-research/continuation.d1.test.ts
bunx vitest run --config vitest.unit.config.ts src/mcp/editorial-research/fingerprint.test.ts
```

Tests execute migrated Miniflare D1 and official MCP 2026-07-28 HTTP tools/call.
They cover direct affiliations, public/managed/legacy references, private-draft
exclusion, null/future publication, rank ordering, stable digest, a 205-hidden-row
discriminator, strict inputs, scope denial, query/write bounds and canonical
Unicode fingerprints. Domain tests use an explicit test authority. The continuation
fixture uses real persisted OAuth and a disposable resource policy, proves matching
E1 versions and revocation before disclosure, and counts actual SQL from both reads
and credential checks against the 16-statement budget. It is an isolated official
protocol composition, not central-route/discovery or production proof; P1 must run
those checks on the final composed head.
