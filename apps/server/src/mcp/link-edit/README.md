# U1 #526: guarded manual music links

This is the manual **3/5** delivery slice, not completion of all selected U1 behavior.
P1 relayed Guide Fari's implementation/integration approval; no merge, auto-merge,
deployment, production migration or live-policy/data activation is authorized.

Base: P1 PR575 exact `6d76116b5407026b53390f85e4bf6eed8a809032`. The isolated
`feat/526-link-commands` worktree contains only this module and the new pure
`services/canonical-music-identity/link-statements.ts`. No R4/Q1 history, shared
registry, schema, legacy factory, inference, metadata refresh or artwork edits.

## Selected capability mapping

| Selection | This slice |
| --- | --- |
| `attach_music_link` | Manual safe typed source attachment to an existing artist/album/track |
| `reject_music_link` | Persist rejected evidence, never implicitly restore it |
| `remove_music_link` | Explicit physical deletion of one link, not its catalogue entity |
| `discover_music_links` | Still selected, unavailable/not registered: no admitted provider transport |
| `refresh_music_links` | Still selected, unavailable/not registered: no admitted provider transport; truthful receipt lookup adoption pending |

`LinkEditToolkit` and `LinkEditHandlersLayer` are exported for P1 composition,
not centrally registered here. Each command independently calls the required
request-scoped `CommandAuthority.checkpoint(['catalogue:write'])`. P1 owns actual
OAuth/session/PAT composition. Tests' explicit SQL grant fixture is not production
OAuth proof. Playlists need their distinct owner/privacy contract; labels are not
accepted by the existing canonical source writer. Neither is silently routed
through these three canonical kinds.

## Contract and deliberate policy

Inputs contain the stable target, UUIDv4 requestId and observed integer
expectedRevision from the shared parent revision. Unknown fields fail decoding.
Attach additionally accepts platform and URL; release accepts linkId. URLs are
parsed by the existing canonical parser, with its manual display mappings:
exact platform; YouTube to YouTube Music; generic safe sources to the existing
seven manual display labels. It does not infer provider aliases or equivalence.

Attach refuses a different existing URL or a rejected platform. Explicitly
remove first, then attach with the new revision; no overwrite flag or implicit
resurrection. Reject retains the row. Remove deletes it. Both release source
ownership only if it is resolved to this target, has no ambiguous alias, and no
other verified display link uses the parsed source. Invalid stored URLs can still
be rejected/removed without fetching them or guessing an identity key. Foreign
or resolving source identities are never deleted by release. Ambiguous source
cleanup is left to identity repair, not guessed during link removal.

Every successful new command advances the parent revision once, including an
explicit re-attachment of the same verified URL or repeated rejection under a
new requestId. An identical retry replays the original result/revision without
repeating mutations. Changed input under one key conflicts. The common store's
24-hour expiry/tombstone policy applies. No lease tokens, source rows, metadata,
private content or provider payloads enter receipts. A receipt contains only
operation, target and committed revision. Current authority and target existence
are checked again before disclosure; a later edit does not invalidate authorized
replay of the original committed revision.

## Atomic SQL and bounds

One read-only preparation observes the parent revision and at most16 platform
slots plus a sentinel (17 rows). A full bounded id/platform/url/status observation is
rechecked by the root CAS, covering legacy link writers that do not bump the
parent revision. Oversized stored IDs/URLs or unknown statuses fail closed.
This is not a scalar-memory, CPU, remote-cost or production-capacity guarantee.

All DML and the final assertion parenthesize the common receipt fence, live SQL
authority and physical parent attempt winner. Source acquisition excludes live
foreign leases, foreign resolved owners, provider/canonical uniqueness conflicts
and normalized-alias collisions. Expired resolving leases may be reclaimed;
the new owner token is the physical attempt, with a DB-time five-second lease
consumed and resolved within the same D1 batch. Identity resolution requires the
same token and a still-unexpired DB-time lease. Coupled aliases/links require a
resolved same-target source and physical parent winner. Assertion failure rolls
back parent revision, source, aliases, link and receipt together.

No raw repository upsert/release wrapper, out-of-batch claim, second receipt
ledger or provider/network work is used. `Database` and `McpOperationStore` MUST
use the same D1 binding. The new builder is side-effect-free; it prepares SQL
only inside the common executor after authorized receipt lookup.

## Remaining provider contract

I1 and P1 confirm that existing raw scraper paths are not an admitted transport.
Do not call them. A future admission must specify provider/operation, outbound
hosts and redirects, credential/data disclosure, bounded input/result/time,
cancellation and ambiguous effects, and pure snapshot versus guarded persistence.
Until then discovery/refresh have no active outbound implementation.

The operations owner is delivering truthful `lookup`: only an exact `miss` may
permit authorized bounded provider work outside the database. Storage failure
must never become a miss. Miss is neither a reservation nor ongoing authority.
After fetch, normal execute uses the same normalized user intent/revisions (not
mutable provider results), fresh trusted time, authority and target versions.
Preparation stays read-only/no-network. Adopt only P1's named cumulative head;
do not weave a sibling lookup branch into this leaf. Provider refresh must
preserve existing/rejected links on failure and stay link-only.

## Verification

Focused migrated-D1 tests cover real shared receipts and SQL plans, active/expired
leases, foreign ownership, alias exclusion, safe manual mappings, no implicit
resurrection, explicit removal, shared source preservation, invalid-row cleanup,
fresh replay authority and original revisions. Adversarial plan tests exercise
opaque OR guards, stale revisions, authority revoked after root CAS and lost
physical winners; all domain/receipt state must roll back. Actual MCP HTTP tests
exercise object-root tools/list, all three commands, replay and authorization
denial. No production or remote D1 is used. Full server tests, bun precommit and
independent Sol actual-PR review are required before handoff; persisted OAuth and
composed cross-lane proof remain P1's responsibility.
