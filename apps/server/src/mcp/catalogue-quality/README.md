# Q1 bounded catalogue diagnostics (#527)

Stacked after R4 #579 exact `0cff71bddb4bca7d7ba9b368f02993213ceb2b24`, retaining
reviewed R1 #565. All five selected tools are retained in `CatalogueQualityToolkit`.
This module adds no central registry, schema, migration, repair or background job.
PR stays OPEN/unmerged, auto-merge off; no production activation is authorized.

Every call requires `catalogue:inspect` and a live admin account, including direct service
calls. It does not impersonate a catalogue reader or require an undeclared `catalogue:read`
scope. Four catalogue kinds only; playlist conflict targets are skipped, not exposed.
The admin diagnostic surface includes null/future catalogue publication timestamps.

| Tool | Inputs | Evidence |
| --- | --- | --- |
| `find_duplicate_candidates` | seed kind/ID, optional afterId/limit | Other same-kind exact SQLite casefolded-name matches; hypothesis only |
| `compare_music_entries` | two explicit kind/ID references | Safe displayed names/missing fields, same reference/kind/name flags; never musical equality or merge authorization |
| `find_incomplete_entries` | kind, optional afterId/limit | Missing-field reasons in an examined ID window, cursor advances through complete rows too |
| `list_music_identity_conflicts` | optional detectedAt/ID tuple cursor and limit | Open conflict IDs, two target references and detected timestamp; cursor advances through excluded kinds too |
| `get_catalogue_quality_summary` | kind, optional afterId/afterSourceKey/limit | Incomplete count in one entity window and active/expired counts in one existing resolving-identity audit window |

## Evidence rules

Duplicate matching uses the full stored name/title, not the displayed prefix. SQLite ASCII
folding is preserved: `Same`/`sAME` match, `Écho`/`écho` do not. No fuzzy search, stemming,
provider inference, cross-kind matching or automatic merge. Blank names yield no candidates.
Compare can report same names across kinds, without converting that into duplicate evidence.
Displayed names are at most200 SQLite Unicode characters (up to400 UTF-16 code units), with
`nameTruncated`; truncated prefixes never drive equality. Missing IDs fail `not_found`.
Calls are observations, not a multi-statement snapshot or write concurrency version.

Missing fields are explicit editorial prompts, not invalid-record judgments:

- All kinds: blank name/title or artwork URL (null/empty/SQLite space-trimmed blank).
- Artist: blank bio. Label: blank description, **never label content/draft body**.
- Album: null release date or no album-artist junction row.
- Track: no album ID or no track-artist junction row. Standalone tracks are allowed;
  this prompt is not a claim that they must be repaired. No invented duration rule.

No public/provider/artwork links, source URLs, provenance, conflict free-text reason,
creator/account IDs, lease owner tokens, provider credentials or private bodies are returned.
Conflict targets are stored evidence and may refer to missing records; no equality conclusion.
`nextSourceKey` is the existing resolving-identity audit primary-key cursor, not a lease token.
Only aggregate active/expired observations are projected from that audit; never its issue details.

## Query and payload budgets

Default20/max50 examined entity/conflict rows, plus one sentinel. ID windows use PK seeks;
same-name candidates use R1 `(lower(name/title),id)` expression indexes plus one seed PK
lookup. At most one seed row is excluded in the matching-name range. Missing artist-credit
checks are LIMIT1 indexed junction lookups. No OFFSET, catalogue-wide count, recursive graph,
provider fetch, generic job or repair. Empty filtered pages can have continuation cursors.

Conflicts seek `(detected_at,id)` under status=open using the existing tuple index.
Summary reuses `auditMusicIdentities` **leases phase only**, which seeks source_key under
state=resolving. It does not call scan-heavy/operational audit phases or maintenance backfill.
The audit returns at most50 rows with no extra sentinel: exactly-full windows require another
request to prove EOF. Its cursor is independent of the catalogue ID cursor. Summary counts
are explicitly `examined_windows_only_not_catalogue_totals`; no implied whole-database score.
Clients continuing one dimension may ignore the other repeated window; do not sum repeated pages.

Responses use object-root schemas and fail explicitly above232 KiB encoded UTF-8, including
both structured JSON and duplicated text. R1's24 KiB framing reserve/read-only16 KiB request-ID
admission caveat applies; this is not a hard wire cap for larger write-enabled echoed IDs.
IDs/cursors are bounded at input; pathological oversized stored IDs fail rather than truncate.
Examined-row limits and projections bound returned work, not arbitrary stored scalar size,
SQLite string-function time, B-tree depth or production latency. No true CPU/memory/remote
read-charge guarantee is claimed from local evidence. Cursors are not snapshot-stable across edits.

## Verification and composition

Real HTTP + fresh migrated local D1 tests exercise all five tools, object-root discovery,
admin-only scope/role checks (including downgrade and ban), asymmetric missing-field rules,
ASCII/non-ASCII matching, excluded-kind cursor advancement, timestamp ties, independent audit
EOF, full-name versus truncated Unicode equality, oversize output and all-table zero-write
snapshots. These are not persisted OAuth or live production tests.

Disposable plan experiment started with2 artists,2 resolving identities and1 open conflict;
added10000 earlier same-name artist IDs,10000 earlier resolving source keys and10000 earlier
open conflict tuples. Queries below returned1 row each before/after; `meta.rows_written=0`:

| Predicate | Actual index SEARCH | rows_read before → after |
| --- | --- | --- |
| `lower(name)=(select lower(name) where id='seed') and id>'seed' and id<>'seed' order by id limit51` | `music_artists_name_id_idx` plus seed PK lookup | 2 →2 |
| `status='open' and (detected_at,id)>(100,'seed') order by detected_at,id limit51` | `music_source_identity_conflicts_audit_page_idx` | 1 →1 |
| `state='resolving' and source_key>'seed' order by source_key limit50` | `music_source_identities_resolving_audit_page_idx` | 1 →1 |

No temp B-tree. Reproduce on fresh disposable D1 using synthetic rows strictly before those
cursors, inspect `EXPLAIN QUERY PLAN` and `.all().meta` before/after. These are Miniflare counters,
not production adequacy or latency measurements. R1/R4 evidence covers the underlying PK seeks.

P1 composes `CatalogueQualityToolkit` through duplicate-checked composition and provides
`CatalogueQualityHandlersLayer` + `CatalogueQualityServiceLayer`, Database and EditorialMcpConfig.
Discovery uses `McpPermission`; handlers independently enforce live authority. P1 must verify
persisted OAuth and the combined R1/R3/R4/Q1/legacy surface on its named cumulative head.
