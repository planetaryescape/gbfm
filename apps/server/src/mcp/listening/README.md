# L1 #536: private listening

Command follow-up based on P1 PR #575 at `695bb12d2149bcbe123f0b6e7661909c4c3ea5ee`,
including shared receipt 0016 and domain revision migrations 0017–0019.
The reviewed read-only PR #560 remains unchanged at `628a6cde9fce9ab44f265e1737a5a016574ea07b`.
Integration owner: P1. Keep all MCP PRs unmerged. This lane does not compose the
production registry, change OAuth/consent, or activate production scopes.

## Capability mapping

| Selected capability         | Input → output                                           | Permission        | Delivery                             |
| --------------------------- | -------------------------------------------------------- | ----------------- | ------------------------------------ |
| `list_saved_mixes`          | `ListeningPageInput` → `SavedMixPage`                    | `listening:read`  | Implemented, no side effects         |
| `list_collections`          | `ListeningPageInput` → `CollectionPage`                  | `listening:read`  | Implemented, no side effects         |
| `save_mix`                  | `SaveMixInput` → original command result                 | read + write | Private create, duplicate preserves state |
| `update_listening_notes`    | `UpdateListeningNotesInput` → original command result    | read + write | Private-only revision CAS |
| `set_listening_status`      | `SetListeningStatusInput` → original command result      | read + write | Private-only revision CAS |
| `create_collection`         | `CreateCollectionInput` → original command result        | read + write | Private create |
| `update_collection`         | `UpdateCollectionInput` → original command result        | read + write | Private-only revision CAS |
| `set_collection_membership` | `SetCollectionMembershipInput` → original command result | read + write | Both targets private and owned; collection CAS |

Command results are minimal `SavedMixCommandResult` / `CollectionCommandResult`
identity and version objects; they never store notes, titles or descriptions.
All commands require both `listening:read` and `listening:write`.
Commands are available through a separate toolkit, **not registered in the central
transport**. Their schemas must be decoded with
`{ onExcessProperty: 'error' }`; Effect 4 schema annotations do not override parse
options. No owner or publication parameter is accepted by that strict decoder.
Each command must be registered with `.annotate(Tool.Strict, true)` so McpServer
enforces that decoding option; activation also requires a protocol-level
`tools/call` test rejecting both `published` and `userId` arguments.
The selected token format is `revision:<positive safe integer>`, starting at 1,
with a ceiling of 9007199254740991. Overflow fails closed, without mutation.
Owner read responses carry versions; anonymous public projections do not.

## Approved command implementation resumption — 2026-11-07

Guide Fari's 17:30 blanket approval, relayed by P1 at 17:32, supersedes the
approval waits below: “everything that needs my approval, you have my thumbs up;
the claude threads that got stuck because of limits, you can take that wrok over
as a medium sol thing instead”. Source: Space
https://ampcode.com/threads/T-01a1b542-e726-7404-8b96-fb50470f1909,
relayed by integration owner
https://ampcode.com/threads/T-01a1b54f-7ac1-7503-9b0f-ffaf3fbc6c3e.
This approves the surfaced shared receipt, revision, client-cutover and
conservative private-edit designs, not production operations or a merge.

L1 resumes the six commands from reviewed leaf `628a6cde9fce9ab44f265e1737a5a016574ea07b`.
MCP edits must atomically require unpublished owned targets. New saves and
collections stay private; duplicate saves preserve all existing state. Membership
changes require both targets owned and private. No publication switch exists.
Browser/API full-form edits must carry their observed version, never fetch the
latest version to retry a stale intent. Mix deletion must atomically invalidate
every affected collection version before cascading memberships.

P1 allocated L1 the private writers in `services/listening.service.ts`, API
listening contracts, HTTP handlers and WWW listening document/form/view, with
isolated tests. Preserve R3's anonymous `publicListeningCollectionPage` method.
No mobile listening caller exists in the inspected `apps/mobile/src` sources.
The common receipt owner is
https://ampcode.com/threads/T-01a1b713-55c7-7157-a67d-6a74b8380884
(`mcp/operations/**`, migration 0016); the sole domain-schema owner is
https://ampcode.com/threads/T-01a1b713-cb20-76f6-a3e4-6e252ab9ffac
(migration 0017). L1 does not create a separate ledger or edit their schema.
Adopt their exact published common head through P1; do not weave sibling branches.
Command activation still requires real migrated-D1 replay/concurrency/all-writer
proof and protocol strictness tests. Fresh persisted OAuth composition remains P1's
responsibility; injected-principal protocol fixtures are not OAuth proof.

## Read composition

P1 imports `ListeningToolkit` and `ListeningToolHandlersLayer` from `tools.ts`,
provides `ListeningReadServiceLive` from `reads.ts`, and provides `Database`.
`McpActor` is supplied per request by P1's authenticated transport.
`ListeningReadServiceLive` provides the existing `McpAuthorizationLive`.
Listener-only accounts need no editorial permission. Each call checks the current
persisted account and scope; SQL filters the actor before pagination. Defaults:
20 rows, offset 0; limits 1–50, offset 0–10,000. Ordering is createdAt descending,
then ID descending. Offset pages are not a transactional snapshot across requests.
No global totals, membership counts, memberships, or cross-owner IDs are returned.

## Command composition and persistence contract

`command-tools.ts` exports `ListeningCommandToolkit` and
`ListeningCommandToolHandlersLayer`. `commands.ts` exports
`ListeningCommandService` and `ListeningCommandServiceLive`; P1 must provide
`Database`, `EditorialMcpConfig` and `McpOperationStore` using the same D1 binding.
Raw D1 stays in composition. This module does not create a second ledger.

The shared store scopes UUIDv4 request keys by actor/client/resource/operation,
hashes normalized input and atomically commits domain statements plus the original
bounded result. Identical retries replay for 24 hours; changed payloads conflict;
expired keys remain nonreusable tombstones. Collection updates normalize omitted
patch fields to null, distinct from an empty description; creation normalizes
omitted description to its persisted empty-string default.

Each mutation includes the common fence and owner/private/revision/account guards.
Coupled membership DML additionally checks the domain marker against the fresh
physical `attemptId`. The final winner assertion aborts the whole batch on lost
CAS. No-op membership consumes one collection revision. Browser/API metadata and
publication edits also consume versions and clear markers; mix deletion invalidates
all affected collections before FK cascades, atomically refusing overflow.

Live target ownership/existence/private state is rechecked before disclosing a
saved receipt, including the original target of a create replay. Persisted grant,
client and scope SQL authority is a shared P1 prerequisite, not claimed by these
injected-principal tests. Do not activate the toolkit until P1 supplies that seam
and proves its authenticated composition.

## Verification boundary

`bun run test:d1 src/mcp/listening/listening.d1.test.ts` exercises real migrated D1
and MCP 2026-07-28 with an explicitly injected principal, not persisted OAuth.
`commands.d1.test.ts` exercises the six commands against migrated D1, including
replay, contention, changed retries, expiry, private/owner guards and browser-writer
invalidation. `commands.protocol.d1.test.ts` composes all eight capabilities locally
and rejects `published`/`userId` excess on every command with `Tool.Strict`.
`bun run test:unit src/mcp/listening/contracts.test.ts` covers command
decoding. P1 must still prove composition with persisted OAuth grants, consent,
revocation and its central registry at the final integrated head. No production
policy, notifications, schema, exports, migrations or shared fixtures changed.
