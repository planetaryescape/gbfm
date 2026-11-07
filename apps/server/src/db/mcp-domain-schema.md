# MCP domain schema contract

Migrations 0017–0020 implement the approved #512 domain facts only. They do not
enable tools, supply a second receipt store, or establish writer coverage.
0020 adds PL2's physical attempt marker and validates the existing playlist
revision through a cross-column CHECK, without triggers or a table rebuild.
Invalid populated revisions abort migration rather than being repaired.
Remote artwork phases belong to the common operation owner, not these tables.

## Revisions and physical attempt fences

| Export | Revision | Physical attempt marker |
| --- | --- | --- |
| musicArtistsTable / musicAlbumsTable / musicTracksTable / musicLabelsTable | revision, integer 0..9007199254740991, default 0 | lastOperationId / last_operation_id |
| musicPlaylistsTable | Existing revision, integer 0..9007199254740991, default 0 | lastOperationId / last_operation_id |
| savedMixesTable / listeningCollectionsTable | revision, integer 1..9007199254740991, default 1 | lastOperationId / last_operation_id |
| listenerMembershipRevisions | revision, integer 0..9007199254740991, default 0 | lastTransitionId / last_transition_id |
| musicReminder | commandRevision / command_revision, integer 1..9007199254740991, default 1 | lastOperationId / last_operation_id |
| postsTable | Existing coherent PostVersion hash; no new numeric revision | lastOperationId / last_operation_id |

Markers are nullable text, with a length-36 check when present. The shared
executor supplies a fresh UUIDv4 `ctx.attemptId` for each physical execution,
distinct from the client request ID; the length check does not validate UUIDv4.
Historical rows may have null markers despite positive revisions. The owner-wide
membership row is stricter: revision 0 requires null, positive requires a marker.
It survives an empty library and receipt cleanup, has no target FK, and only
account deletion cascades it. Account identities must not be reused.

Every command must acquire its parent CAS first. All coupled statements require
both the common executor's `ctx.fence` and that parent's marker = `ctx.attemptId`.
The final `assertApplied` must verify that physical winner and abort the batch
on failure. A zero-row D1 UPDATE is successful SQL, not a rollback; neither
`changes()` after intermediate statements nor a timestamp proves CAS ownership.
Reject exhausted revisions rather than wrapping or refreshing stale intent.
Ordinary browser/API writes clear or replace markers when advancing revisions.
No marker references a receipt: receipt redaction must not rewrite domain rows.

There are deliberately no invalidation triggers. M1 owns metadata, billing
junction projection, artist rename/delete, album-delete track invalidation,
genres and both affiliation endpoint revisions in its atomic batches. I1 owns
canonical/raw creation and mutation participation. M2 uses parent artist/track/
album revisions for aliases/credits, not a second observation ledger; unchanged
facts may install a new marker without bumping under that command's contract.

L1 owns mix metadata/publication and collection metadata/membership revisions.
Each new accepted membership intent bumps once, including desired-state no-ops;
exact replay does not bump. Before deleting a mix, its writer must atomically
bump and clear markers of every affected owned collection, failing the whole
batch at exhaustion, then remove the mix and cascade memberships. The unchanged
membership PK/FKs alone do not provide this invalidation. Private MCP note edits
must reject already-published mixes; no new publication field is accepted.

L2 uses one persistent owner-wide revision for audio/show favorites and show
subscriptions, including their coupled effects. Missing row means revision 0;
initialize lazily in the guarded batch. Every accepted new intent bumps, even a
no-op; deletion of membership rows cannot reset observed versions.

## Reminder historical classification

0017 maps coherent `is_sent=1,status=sent` to accepted and **every** coherent
unsent pending/processing/failed row to fenced, including future schedules.
Existing data has no durable evidence that dispatch never began. Inconsistent
combinations produce NULL into a NOT NULL column and abort the migration batch;
there is no silent repair. New rows default to open. This means all historical
reminders refuse later cancel/reschedule under the new writer contract.

The processor's existing updatedAt claim generation is not commandRevision.
Only new user commands increment that revision. Dispatch fences are sticky;
recovery never reopens them. Cancellation retains the row as cancelled/unsent/
legacy pending, not a physical delete. Accepted means sent/is_sent=1. Processor
and API owners must enforce these transitions and truthful conflict responses.
Provider delivery remains at-least-once; schema state cannot prove recall or an
atomic D1/provider transaction.

## New facts and ordered references

`music-credit.schema.ts` exports musicRecordingCreditsTable and
musicArtistAliasesTable. Credits have exactly one album/track FK (cascade),
optional linked artist FK (restrict), required credited name/key, four checked
roles, instrument/key rules, namespace-prefixed participant key, nonnegative
integer displayOrder, public source evidence, nullable asserting account (SET
NULL), assertedAt and createdAt. Partial unique target/participant/role/instrument
indexes reject duplicates without forbidding multiple instruments. Aliases are
unique by artist/nameKey, never globally, and cascade with their artist. Neither
table backfills old billing/source identity facts. Services own Unicode NFC,
whitespace/lowercase normalization, URL/privacy/bounds validation and explicit
alias-primary-name reconciliation; SQLite lower() is not an equivalent parser.

`post-music-reference.schema.ts` exports postMusicReferencesTable: composite
postId/position PK, integer positions 0..49, exactly one typed album/track/playlist
FK (restrict), post cascade, distinct target per post, and at most one primary.
Contiguous positions and compatibility primary projection belong to the atomic
post writer. No inferred backfill runs: legacy primary pairs remain untouched,
including invalid pairs which the application must flag rather than erase.
postsTable.musicReferencesManaged / music_references_managed defaults false;
only a committed explicit full replacement sets it, including an empty list.
Writers never reset it. PostVersion includes ordered identities/primary/managed
state from one coherent snapshot; published managed reference state is frozen.

## Retention and verification boundary

Account deletion cascades private listening/reminder state and owner revision;
public fact attribution becomes null without deleting facts. Client deletion has
no FK effect on those tables. The common receipt owner handles 24-hour result redaction,
fresh replay authorization and actor/client deletion scrubbing while preserving
opaque anti-replay tombstones. Domain rows are not pruned with receipts.

## Creator, metadata review and merge extensions

0022 adds revision (integer 0..9007199254740991, default 0) and nullable
length-36 lastOperationId to the existing audioTable/showsTable exports.
Populated rows become 0/NULL without invented receipt evidence. No dependencies,
cascades or timestamps change. Creator writers own shared browser/PAT/MCP CAS,
increment, overflow refusal and coupled-write fencing; these columns alone do
not establish writer coverage or permit deletion of dependent content.

0023 exports musicMetadataProposalsTable from metadata-review.schema.ts.
currentValue/proposedValue are raw, nonnull canonical JSON scalar TEXT: JSON null
is the string `null`, never SQL NULL. Storage checks target/field correspondence,
scalar types and field bounds, distinct encoded values, top-level evidence array
size 1..5, lowercase hash, status, safe revisions/times and physical marker.
The backend parses canonical scalars and strict evidence objects {linkId,reason},
enforces their bounds and same-target public/non-rejected stored-link evidence,
and compares current target revision/value in the fenced insert/reuse batch.
Creation does not increment target revision. The partial pending uniqueness key
includes actor/client/resource/target/revision/field/hash; multiple common receipts
may reuse one proposal. There is no receipt FK or independent operation ledger.
The required client/resource FKs limit this slice to real persisted OAuth clients
and resources. Browser/session and automatic re-scrape ingestion remain unsupported;
they must not synthesize client/resource rows to bypass this ownership contract.
Actor/client/resource deletion cascades private proposal content. No expiry job,
acceptance/rejection tool or catalogue mutation is added. Terminal immutability
and no-reopen rules belong to future backend transitions, not a static CHECK.

0024 exports musicEntityMergesTable from music-merge.schema.ts. The common digest
is its operationId, without an expiring receipt FK. Active source IDs are unique
within entity type; source-slug and image-expiry indexes support lookup/cleanup.
Undo images are nullable valid JSON, at most 262144 UTF8 bytes. createdAt and
undoExpiresAt are safe integers exactly 24 hours apart; restoredAt is nullable.
No account, entity or client FK can erase minimal redirects. The owning backend
clears beforeImage at now >= undoExpiresAt while retaining the redirect, rejects
expired or afterDigest-mismatched restores, and never exposes images over MCP.
Images may contain moved/deleted domain rows only, not post bodies or provider/
account payloads. Attribution privacy/existing-account checks are backend policy;
this schema does not silently invent exact-restore guarantees for deleted actors.

The migration D1 tests prove schema/defaults, fresh and populated replay,
historical classification failure, constraints and FK policies. They do not prove
browser/API/MCP writer atomicity, service normalization, private projections,
cross-tool replay authorization, provider recovery or final integrated behavior.
Those proofs remain with the owning lanes and P1's exact-head integration.
