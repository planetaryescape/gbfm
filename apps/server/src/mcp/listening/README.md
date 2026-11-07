# L1 #536: private listening

Dependent on P1 #514 at `2d1b5592826e66e3a198dc117c153e062264fc5c`.
Integration owner: P1. Merge prerequisite first. This lane does not compose the
production registry, change OAuth/consent, or activate production scopes.

## Capability mapping

| Selected capability | Input → output | Permission | Delivery |
| --- | --- | --- | --- |
| `list_saved_mixes` | `ListeningPageInput` → `SavedMixPage` | `listening:read` | Implemented, no side effects |
| `list_collections` | `ListeningPageInput` → `CollectionPage` | `listening:read` | Implemented, no side effects |
| `save_mix` | `SaveMixInput` → original command result | `listening:write` | Contract only, receipt gate |
| `update_listening_notes` | `UpdateListeningNotesInput` → original command result | `listening:write` | Contract only, revision/receipt gate |
| `set_listening_status` | `SetListeningStatusInput` → original command result | `listening:write` | Contract only, revision/receipt gate |
| `create_collection` | `CreateCollectionInput` → original command result | `listening:write` | Contract only, receipt gate |
| `update_collection` | `UpdateCollectionInput` → original command result | `listening:write` | Contract only, revision/receipt gate |
| `set_collection_membership` | `SetCollectionMembershipInput` → original command result | `listening:write` | Contract only, revision/receipt gate |

Command success schemas are deliberately not promised before receipt approval.
Any command result containing private state additionally requires `listening:read`.
Commands are **not registered** or callable. Their schemas must be decoded with
`{ onExcessProperty: 'error' }`; Effect 4 schema annotations do not override parse
options. No owner or publication parameter is accepted by that strict decoder.
The version token format remains opaque pending the coordinated revision design;
read responses do not pretend to supply a concurrency token yet.

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

## Migrated D1 evidence and command gate

On 2026-11-07 a disposable probe used `createMigratedD1Database` through the
existing test layer (real Miniflare/workerd D1, migrations 0000–0014) and called
the existing listening service, without mocks or production access:

- Concurrent canonical-URL saves produce one private row; repeating a save after
  an edit preserves notes and status. Natural-key deduplication is **not** the
  approved request-key replay contract (changed payloads are not rejected).
- Concurrent identical collection creates produce two collections.
- A later notes edit is overwritten by a stale status form snapshot.
- Include → remove → retry old include restores membership, undoing the newer
  removal. Desired state alone does not provide durable replay semantics.
- `PRAGMA table_info` confirms no revisions in saved_mixes or
  listening_collections and only collection_id/mix_id in listening_memberships.
- editorial_operations has id/actor_id/post_id/input_hash/result/created_at;
  draft-store ties receipt insertion to post rows and editorial eligibility.
  It is not a general listening receipt store. No fake post IDs or second ledger.

The disposable probe passed its observed-state assertions and was removed rather
than preserving tests that enshrine unsafe behavior. Permanent tests cover the
new read protocol/owner boundary and strict candidate command contracts.

### Exact decision requested from the schema coordinator

Approve one shared durable receipt seam: unique actor + OAuth client + operation
+ UUIDv4 requestId; normalized payload hash (including expected version and
omitted/null distinctions), target IDs, original bounded result and resulting
version. Atomically commit mutation and receipt; simultaneous retries apply once,
identical retries replay for 24 hours, changed payloads conflict. After result
expiry, durable minimal key/hash/expiry tombstones must prevent re-execution;
private result purge and tombstone retention require an explicit policy decision.
Recheck live account/grant/scope and current target ownership on replay; private
results require read authority. No selected operation deletes or publishes.

Approve atomic mix revisions for notes/status, and collection revisions covering
both metadata and memberships. All writers, including existing browser/API paths,
must participate. Membership writes check ownership of both targets in the write.
Duplicate saves preserve existing notes/status/title/visibility; new rows are
private. No publication switch is part of these commands. Notes edits to already
published mixes require a separate privacy decision: changing notes would change
public text, so do not activate this path as a private edit by accident.

Affected paths, **not reserved or changed here**: `db/listening.schema.ts`, one
centrally chosen shared receipt schema, `db/exports.ts`, `drizzle-d1/` migration,
`test/migrate-d1.ts`, and serialized private command seams in
`services/listening.service.ts`. R3 retains its separate additive public projection.

## Verification boundary

`bun run test:d1 src/mcp/listening/listening.d1.test.ts` exercises real migrated D1
and MCP 2026-07-28 with an explicitly injected principal, not persisted OAuth.
`bun run test:unit src/mcp/listening/contracts.test.ts` covers candidate command
decoding. P1 must still prove composition with persisted OAuth grants, consent,
revocation and its central registry at the final integrated head. No production
policy, notifications, schema, exports, migrations or shared fixtures changed.
