# Creator commands — C1, C2, C4

Work in progress for #539, #540 and #542. Six candidate tools are implemented
and exercised locally; none is registered in the central production toolkit.
Reply creation and durable private-media publication remain blocked. None of
these issues is complete.

Initial prerequisite: PR #568 at
`8dbd4f4863ddab00238f955913ca064629e7b321`. Adopted P1's named command foundation
PR #575 through named `aa3396668b79a6401cf21f68711933cf10e70091`, containing
the shared durable operation store, schema through 0025, live persisted OAuth SQL
authority, E1 post guard and physical-winner `ctx.assert` checkpoint. No sibling
branches were woven. R3's reviewed ancestry helper PR #597 is not in that named
base; a later P1 serial adoption is required before reply implementation.
Authorization callbacks alone do not lock authority inside the mutation batch.
No production migration, policy activation, data write, deployment, merge or
auto-merge is authorized.

## Capability mapping

| Issue | Selected tool | Input and authority |
| --- | --- | --- |
| C1 #539 | `list_creator_drafts` | Bounded owned mix/show draft metadata; `creator:read`; no admin-wide listing, bodies or media URLs |
| C1 #539 | `update_creator_metadata` | UUID request identity, canonical target and expected persisted revision; `creator:write`; title/description only |
| C2 #540 | `create_micro_post` | UUID request identity and bounded canonical content; separately consented `micros:publish`; public side effect |
| C2 #540 | `reply_to_micro_post` | Above plus canonical parent ID; public focus/root/full ancestor path checked at apply; server derives thread fields |
| C4 #542 | `publish_editorial` | Canonical post ID, expected shared post version and UUID request identity; target write authority plus `content:publish` |
| C4 #542 | `unpublish_content` | Explicit post/micro/mix/show target and corresponding post version or creator revision; target write authority plus `content:publish` |
| C4 #542 | `delete_content` | Same version-bound target; target write authority plus separate `content:delete`; no implicit cascade |

All require a live creator-class account and current ownership; admin role alone
does not bypass ownership. Target-specific scope combinations, enabled discovery
and registry wiring remain P1-owned. Existing grants are not upgraded. A request
receipt is not authority to expose private state or apply another command.

## Persistence and compatibility

The adopted `0022_creator_revisions.sql` gives existing `audioTable` and
`showsTable` a `revision` (integer 0 through Number.MAX_SAFE_INTEGER, default 0)
and nullable `lastOperationId` (`last_operation_id`, length 36 when present).
Existing rows start at 0/NULL without invented historical operations. These are
not timestamp aliases. Frozen migration 0017 remains unchanged.

Browser/PAT and MCP writes must compare and advance the same revision. All
coupled metadata/owner/tag/artist/asset writes must share the winning physical
attempt fence. MCP commands must save the outcome in the same durable-operation
batch, not call an existing committing method and save a receipt afterward.
An exhausted safe integer revision must refuse rather than wrap.

Optional `expectedRevision` on legacy HTTP inputs preserves their shape, not a
stale-intent guarantee. A caller without an observation gets only race protection
against the source loaded by that request. A version-aware client must send the
revision it displayed; silently refreshing at submit is not equivalent. Client
cutover and its scope must be recorded separately.

Browser show deletion retains its existing episode-detachment behavior. Its
single batch stamps the show CAS winner, versions every detached episode with
the same physical attempt, removes owned labels and deletes only that marked
show. Child overflow refuses the whole operation. MCP deletion is deliberately
different: it refuses dependent episodes, replies/quotes, navigation entries,
external post provenance, favorites, subscriptions and featured selection;
there is no implicit cascade to those records. Both preserve database RESTRICT
constraints. Deletion never deletes storage objects or revokes public bytes.

For MCP deletion, the batch order is CAS stamp → fenced owned relation removal →
`ctx.assert(winner + live authority + dependency guard)` → same-marker deletion →
final absence assertion and receipt. Absence alone is not evidence that this
physical attempt won. A failed assertion or SQL write rolls back the receipt,
target stamp and all relation writes together.

Root micro creation and editorial publishing reject recognized private media
URLs rather than copying them or claiming an applied outcome before durable
copy recovery exists. Unpublish and delete make no storage/provider calls.

Existing editorial snapshot/version and actor/requestId receipts remain E1-owned
and unchanged by this lane. New commands use the shared durable store; no second
ledger. Replay rechecks current account/grant/scopes and target access, including
ownership. Lifecycle replay may acknowledge an authorized completed transition
after deletion/publication, but cannot disclose newly private bodies or confer
authority from stale receipt state. Missing unrelated IDs remain `not_found`.

## Ownership

This lane owns new `mcp/creator/**` and `services/creator-command/**` modules and
their tests. P1 owns central registry/scopes/OAuth/shared fixtures and names the
integrated prerequisite. E1 owns existing PostService mutations, source hydration,
model/snapshot and shared post guard internals. Only additive PostService imports,
interface declarations and layer wiring are reserved here; implementation belongs
in creator-command modules and reuses existing validation/thread derivation.

P1 granted narrow audio/show service update interfaces and `updateEffect`, show
`deleteEffect`, API response/input fields and HTTP update adapters. No schema,
shared fixture, existing PostService method or frontend file is reserved here.
Shared-file integration is serialized, not a whole-file ownership claim.

## Local evidence and remaining gates

The owned real-D1 tests exercise actual OAuth command authority and a disposable
HTTP MCP composition: root micro create → version-bound delete → exact replay →
revoked-client HTTP denial. Service scenarios cover concurrent retry, changed
payload/stale revision, owner loss, admin-without-ownership, browser/MCP revision
conflict, coupled rollback, overflow, unpublish and editorial publish replay.
Delete probes cover dependent-user-state refusal, storage-failure rollback of
all target fields and owned relations, retry after deletion, and an ID reused by
another owner. Browser show tests verify episode revision/marker advancement and
unrelated-field preservation, plus overflow refusal. These are local candidate
tests, not final integrated-head or production evidence.

Still required:

- Real migrated D1 application of all seven commands, concurrent identical retry,
  changed payload, expiry, stale revisions, current grant/role/owner loss and
  publication races, with persisted winner/receipt assertions.
- Public full-ancestor reply checks, server-derived root/depth, hidden/deleted
  parent denial and no notification/provider/media side effects during preparation.
- Browser/PAT versus MCP revision races and no partial relationship/asset writes.
- Media/reference dependency safety and no implicit deletion cascade; lifecycle
  replay after deletion/publication without private-state disclosure.
- P1 final-head registration/discovery and composed client cutover proof, a
  normal OPEN PR and independent Sol actual-PR review.

Boundary probes and typechecking of the contract alone prove none of these runtime
claims. All MCP PRs remain unmerged with auto-merge disabled.
