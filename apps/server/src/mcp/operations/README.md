# Shared durable local operation phase (#512)

Base: PR568, `8dbd4f4863ddab00238f955913ca064629e7b321`. P1 owns integration.
This implements the common **non-post** receipt/executor, not domain schemas,
tool registration, caller cutovers or provider delivery. Existing editorial keys
and `editorial_operations` are unchanged. No production activity is authorized.

## Frozen public leaf API

Import from `@/mcp/operations/store`:

- `createMcpOperationStore(database: D1Database)` at composition/test boundaries.
- `McpOperationStore` Effect Context service and `McpOperationStoreLayer(env.DB)`.
  P1 provides the layer alongside `DatabaseLayer` with the **same** raw binding;
  domain layers consume the service, never reach into Drizzle internals.
- Types `JsonValue`, `OperationKey`, `OperationOutcome`, `OperationContext`,
  `AtomicOperationPlan`, `LookupOperation`, `ExecuteOperation`, `OperationPreparation`,
  `OperationReceipt`, `OperationResult`, `OperationLookupResult`.

`execute({ key, normalizedInput, now, authorize, build })`:

```ts
key: { actorId, clientId, resource, operation, requestId }
authorize: (outcome?: OperationOutcome) => Promise<boolean>
build: ({ attemptId, operationId, fence, prepare }) => ({
  statements: readonly D1PreparedStatement[],
  assertApplied: SQL,
  outcome: { result: JsonValue, revision: JsonValue, access: JsonValue }
})
```

Success is `{status: 'applied'|'replayed', operationId, outcome, createdAt,
expiresAt}`. Failures contain only `status`: `conflict`, `not_found`, `expired`,
`access_denied`, `invalid_input`, `unavailable`. Times are epoch milliseconds.
`unavailable` is ambiguous, **not** proof of rollback; retry the same key/input.
Postcommit access loss can return denial after a successful mutation. A later
authorized same-key retry recovers the saved result.

For effectful **read-only** current-state observation/preflight, supply `prepare`
instead of `build` (exactly one). The store first authorizes and reads the receipt;
an exact replay, mismatch, expiry or access denial bypasses preparation entirely.
`prepare: () => Promise<OperationPreparation>` returns
`{status:'ready', build:(ctx)=>AtomicOperationPlan}` or a status-only
`conflict/not_found/invalid_input/unavailable`. A rejected promise returns
`unavailable` with fixed safe `receipt.prepare/domain/preparation_failed`
diagnostics, never an input-validation error. Typed `unavailable` is also reported.
No receipt is reserved for a preparation rejection; a corrected request can retry.
The store internally rechecks a receipt before returning a preparation rejection,
so an identical concurrent winner takes precedence over a newly stale observation.
Callers do not perform their own receipt lookup or maintain another ledger.

Preparation may read persisted state and compute a snapshot/no-op projection;
it must not write, reserve domain state or call a provider. Its returned builder
is still synchronous and side-effect-free. Observations are not locks: all current
authority, revisions, no-op markers and coupled writes must still be guarded and
asserted inside the one physical-attempt-fenced batch. Sync build exceptions retain
the existing invalid-input behavior; expected observation failures use the typed
preparation result instead of throwing from build.

### Authorized lookup before bounded provider fetch

`lookup(input: LookupOperation): Promise<OperationLookupResult>` accepts the same
trusted `key`, normalized input, epoch-millisecond `now`, and `authorize(outcome?)`
as execute, without a builder/preparation callback. It shares the executor's
identity/hash validation, live authorization, stored-outcome decoding and expiry
redaction. It returns exactly `{status:'miss'}` for an absent key, an original
`{status:'replayed',operationId,outcome,createdAt,expiresAt}`, or a status-only
`conflict/expired/access_denied/invalid_input/unavailable`. Storage/auth/codec
failures are **never** misses. Lookup never claims a key or mutates domain data;
its only write is the existing expired-receipt privacy redaction.

U1 recipe (composition/domain names below are illustrative):

```ts
const intent = { key, normalizedInput, authorize }
const prior = await store.lookup({ ...intent, now: clock.now() })
if (prior.status !== 'miss') return prior

// Caller owns current provider authority, bounded fetch, timeout and response parsing.
const snapshot = await fetchBoundedProvider()
return store.execute({
  ...intent,
  now: clock.now(), // Fresh after fetch: never reuse the preflight timestamp.
  prepare: () => prepareDomainSnapshot(snapshot), // Read-only DB observation/preflight.
})
```

Miss is not a reservation, a provider authorization token, or a promise that the
key stays absent. The caller must authorize and bound provider access separately;
no provider fetch occurs inside this store, `prepare`, a builder, or a D1 batch.
Keep key and normalized **user intent/revisions** identical across lookup/execute;
do not hash a mutable provider response or silently substitute new user input.
After the fetch, execute receives a **fresh trusted time** and reruns live
authorization and receipt inspection before preparation. Another concurrent fetch
can already have won: execute replays its original result, detects a changed
payload or expiry, or denies revoked authority without applying the later snapshot.
Different keys still compete through the existing domain CAS and physical fence.
Do not implement a miss probe by returning `unavailable` from preparation or keep
a per-request in-memory replay flag/second ledger. No tool/HTTP lookup endpoint
or provider-in-transaction guarantee is added by this service method.

Unavailable paths emit `mcp.operation.unavailable` through the Effect logger,
with fixed operation/dependency/coarse-code fields for lookup, decoding, batch,
authorization callback and expiry cleanup failures. The optional second factory
argument is an intentional `OperationDiagnostic` reporter seam for composition
and recording tests. It receives no raw error, SQL, key, IDs or receipt data;
reporter failure cannot alter the committed outcome. Expected CAS conflicts do
not report an outage, and batch-failure diagnostics preserve lost-response recovery.

The key is SHA-256 of the canonical JSON tuple actor/client/trusted configured
resource audience/operation/UUIDv4 request ID. Request UUID hex case is normalized.
Resource/client/actor come from trusted composition, not command fields. Browser
and PAT namespaces must be explicitly assigned by P1, not masquerade as an OAuth
client; `clientId` is a trusted namespace string, not necessarily an OAuth FK.
OAuth-client deletion redacts that matching namespace through a database trigger.
Other namespace retirement must use an equivalent approved cleanup integration
before those callers are enabled. No browser/PAT namespace is invented here.

The input hash is SHA-256 of canonical JSON: recursively sorted object keys,
preserved array order, omission distinct from explicit null, finite numbers only.
The owning service supplies already-normalized desired input, target IDs and
**all caller-observed expected revisions**. Include those revisions even when
the desired state is a no-op. Do not pass an input hash supplied by a client.
Normalized input is capped at 256 KiB UTF8; only its digest is stored.

## Authorization is a caller/service obligation

`authorize(undefined)` runs before receipt lookup. `authorize(savedOutcome)` runs
before every successful applied/replay disclosure, including creates whose target
ID exists only in saved `access`. False denies; rejection returns unavailable.
Use live persisted grants, account/role, scopes, audience/client/operation and
current target ownership/visibility/existence, including actual inferred/reused
playlist type for imports. Decode domain-specific saved access evidence before
using it. The store parses JSON but cannot know domain authority.

Non-lifecycle missing/hidden targets do not replay. Lifecycle acknowledgements may
use commit evidence only as allowed by P0, never as permission to read new private
state. A reminder becoming fenced/accepted need not prevent authorized replay of
its original outcome: current mutability and current access are separate checks.
Private result fields still require current read authority. No generic tool/HTTP
receipt lookup or handle-based private result endpoint exists here.

The owning SQL statements must also enforce current account/grant/role/visibility
and domain revision preconditions **inside the batch**. The callback is not a
transactional authorization lock and does not replace these predicates.

## Atomicity and physical fencing

1. Build synchronously without SQL execution or network effects. Random IDs for
   creates are safe inside build: only the winner commits and its original IDs
   are saved atomically. Preflight the final wire envelope **before** execution.
2. Executor claims the scoped receipt with fresh physical UUIDv4 `attemptId`.
3. Every domain mutation includes `ctx.fence`; it tests receipt ID, input digest,
   physical attempt and pending state. The request UUID is **not** a winner fence.
4. Domain CAS compares caller-observed revisions and legal live state and stores
   the physical attempt in a domain marker (`lastTransitionId`, or an equivalent
   lease/creation marker). Every subsequent junction/projection mutation requires
   both receipt fence and domain winning marker/revision. Domain rows/revisions
   survive membership removal; the executor does not own their lifetime.
5. `assertApplied` proves that domain marker belongs to this attempt, not merely
   that desired state exists. For a domain-approved no-op, update the attempt
   marker without changing revision, then assert it. For multiple targets prove
   all required wins/leases. The executor cannot infer this SQL from a revision.
6. Finalization sets saved outcome only when that assertion is true. False makes
   the named `mcp_operation_winner` CHECK fail, **aborting the entire D1 batch**,
   including claim and any already-executed coupled writes. A zero-row CAS never
   silently finalizes. Constraint failure and other SQL failures also roll back.

For physical deletion, append `ctx.assert(winnerAndLiveAuthority)` after the CAS
and coupled writes but **before** deleting the row holding the attempt marker.
This synchronous builder returns a statement for `plan.statements`; it performs
no SQL during build. The store checks this predicate only under the physical
attempt/input/pending receipt fence. False uses the same winner CHECK to abort
the batch; true leaves the receipt pending, so later `ctx.fence` predicates remain
valid. Include current actor/grant/role/ownership/visibility in the caller's
assertion, not just the marker. Every domain DML still needs its receipt fence
and appropriate winning marker; this checkpoint does not replace those guards.
Delete using both guards, then use final `assertApplied` to prove the expected
absence. **Absence alone is never physical-winner proof**: it is valid here only
after the intermediate assertion in the same atomic batch. Finalization remains
required and rolls back the earlier checkpoint/writes if deletion did not occur.
Saved deletion evidence must permit fresh owner-bound replay authorization
without requiring the deleted row to exist; revocation must still deny replay.
Domain code never writes the receipt table or uses `changes()` to infer a winner.

One D1 batch owns claim, all statements, winner assertion and outcome. There is
no in-memory replay. Duplicate concurrent claim loses `ctx.fence`, so its domain
statements cannot run and it reads the original persisted result. Competing
different keys at one revision produce one winner and one rolled-back conflict.
The real migrated-D1 regression deliberately includes unguarded coupled DML after
a zero-row CAS to prove assertion rollback, not just post-hoc classification.
That test is NOT permission to omit per-statement fences: a same-key loser does
not own finalization and therefore must never execute unfenced domain writes.

## Results, retention, deletion and cleanup

Save only bounded original `{result,revision,access}` JSON: maximum 64 KiB encoded
UTF8 for the **whole** object, enforced before batch and in SQL. Target/revision
descriptors are domain-owned JSON, not fake post IDs. Save only minimal safe access
evidence, not notes, credentials, provider bodies or resumable signed URLs.
Replay returns the original result/revision even after later edits; it does not
substitute a fresh read. Callers independently enforce their full 256 KiB encoded
duplicated MCP envelope, including endpoint fields and escaping.

Policy selected under the consolidated approval:

- Replay window is exactly 24h from the winning acceptance/commit timestamp
  supplied by the trusted clock. At `now >= expiresAt`, never execute again.
- On expiry, redact **all** outcome/result/revision/access, actor/client identifiers
  and physical attempt. Retain only opaque scoped key digest, input digest,
  expired state and timestamps. These anti-reapplication tombstones are not
  pruned or rotated while the corresponding key namespace can be eligible. No
  private result or raw request key is kept indefinitely.
- `pruneExpired(now)` redacts unvisited expired results; execution also lazily
  redacts an expired accessed key. P1 must wire the existing maintenance owner
  before activation (at least daily means physical removal within 48h, not a
  claim of automatic deletion at exactly 24h). No new scheduler is added here.
- User deletion uses a BEFORE DELETE trigger to redact immediately, then the
  actor FK is `ON DELETE SET NULL`. OAuth-client deletion similarly redacts
  immediately; there is deliberately **no client FK cascade** that could erase
  the key or reject trusted non-OAuth namespaces. Recreating an actor/client ID
  cannot make its retained request key executable again. Current authorization
  must still deny deleted actors/clients before disclosing any receipt status.
- No FK to a domain target: cancellation/deletion cannot erase replay evidence.
  This does not authorize indefinite domain payload retention or target access.

## Imports/artwork boundary — not implemented by this phase

This API can include canonical source-lease checks and catalogue create/reuse,
identity links, junctions, derived projections and revision updates in **one local
atomic phase**, once the owning canonical service contributes those statements.
Save original created/reused disposition; never infer it on retry from a source
lookup. Existing domain services are not automatically transaction participants.

There is no durable acceptance queue, phase lease, remote upload or association
recovery API in v1. A saved `artwork: pending` value alone does not provide those
guarantees. Do not perform provider/upload work inside build or treat an immutable
receipt as mutable enrichment state. Network calls cannot share a D1 transaction.
Staged work needs a separately coordinated extension of this common store,
durable phase/lease fences, stable object identity and revision-guarded association;
until it exists and is proved, imports requiring that lifecycle stay gated.

## Local proof

Run `bun run --filter @gbfm/server test:d1 src/mcp/operations` and `bun precommit`.
Tests use the real forward migration chain in isolated Miniflare D1, not schema
push or production bindings. They prove persisted original replay, hash semantics,
duplicate/CAS contention, zero-CAS transaction rollback, SQL failure rollback,
live authorization denial, exact expiry, cleanup and deletion/recreation safety,
bounds and schema/export parity. Domain caller cutovers and final persisted OAuth
composition remain each owning lane/P1's integration checks, not claims of this
storage adapter's fixture.

## Staged artwork extension (0021, not activation)

Import from `@/mcp/operations/staged-store`:

- `createArtworkStageStatement(ctx, seed)` joins the original catalogue
  `AtomicOperationPlan.statements`. Seed contains disposition, entity type/ID,
  observed catalogue revision, freshly parsed canonical `sourceIdentityKey`, and
  `artworkPolicy: 'required'|'best_effort'`. `preserve` never creates a stage.
- `createMcpArtworkStore(env.DB)`, `McpArtworkStore`, `McpArtworkStoreLayer(env.DB)`
  use the **same** binding/receipt as the atomic store, not a second request ledger.
- Exported types: `ArtworkStageSeed`, `ArtworkArtifact`, `ArtworkLease`,
  `ArtworkStage`, `ArtworkRequest`, `ArtworkResult`, `ArtworkTransition`,
  `ArtworkAssociationContext`, `ArtworkAssociationPlan`, `ArtworkDiagnostic`.

All `read/acquire/renew/transition/associate` inputs include the same scoped
`key`, normalized input, trusted epoch-millisecond `now`, fresh
`authorize(stage?)` callback, and `liveGuard: SQL`. Authorization runs before
lookup, with stored target evidence before action, and before successful result
disclosure. Keep current authority/visibility in `liveGuard`; put revision CAS
in the domain statements, not a predicate invalidated by that CAS itself.

`read` returns `{status:'ready',stage}`; `acquire` returns
`{status:'leased',stage,lease:{attemptId,generation}}` or `busy`. Other methods
return `ready` or a status-only `conflict/expired/not_found/access_denied/
invalid_input/unavailable`. A terminal phase can be read/replayed but never
reopened. Ambiguous storage outcomes require reading the same operation, not
creating a new request. The original receipt outcome is never enriched in place.

`pending → uploading → association_pending → delivered`, or a definitive
`failed`, is durable. Acquire/takeover uses a fresh UUID physical attempt,
monotonically increasing generation and a 60,000ms lease. The owner renews every
20,000ms; expiry permits takeover at `leaseExpiresAt <= now`, not resurrection
of the old attempt. Renewal, transition and association check the complete
operation/attempt/generation/unexpired lease plus live authority fence.

`transition({...request,lease,transition:{phase:'uploading',artifact}})` freezes
SHA256 lowercase hex, allowlisted JPEG/PNG/WebP content type and 1..10MiB length.
The store derives `music/<type>/<id>/imports/<operationId>/<sha256>/cover`.
Descriptor immutability survives takeover: an old uploader can at worst PUT the
same frozen bytes to the same key, never overwrite a different snapshot.
The orchestrator must verify bytes/digest and remote existence; only then may it
request `association_pending`. PUT timeouts do not imply success or terminal
failure. This adapter does no network work and cannot attest object existence.

`associate({...request,lease,build})` supplies `ArtworkAssociationContext`
(`OperationContext` plus `stage`) to a sync builder returning domain statements
and `assertApplied`. CAS the entity's original observed catalogue revision,
associate the frozen key, increment revision and save the physical attempt
marker. Coupled statements also require that marker. Final delivered evidence
and domain writes share **one** D1 batch. Its CHECK assertion executes even when
the lease fence is lost; a zero-row CAS or lost fence aborts all coupled writes,
not just post-hoc result classification. `associatedRevision` is exactly original
catalogue revision + 1; there is deliberately no implicit rebase/checkpoint API.
After a lost response, delivered evidence is replayed; otherwise read/resume the
same phase/key and let the original revision guard reject later administrator
edits. A definitive failure uses only bounded allowlisted failure codes, never
remote messages; transient/ambiguous errors leave the durable phase unchanged.

Source identity accepts only `url:sha256:<64 lowercase hex>`, Spotify's four
entity types with bounded alphanumeric IDs, Deezer's four types with numeric IDs,
and YouTube video/playlist with bounded alphanumeric/underscore/hyphen IDs.
Never store candidate/signed/provider URLs, tokens or provider payloads. I1 owns
authorized canonical source lookup and reproducible bytes outside the database.

### Staged retention and retirement

Receipt `pruneExpired(now)` still redacts the original bounded result at 24h and
leaves a non-reapplying tombstone. It does **not** age out in-flight work, reset a
lease/phase, or delete an object. Active stages retain minimal source/ref/revision
and frozen descriptor needed for recovery, even after the original result TTL.
Terminal stage reads after that TTL return `expired`, not the saved result.

`pruneTerminal(now)` retires only delivered/failed stages whose receipt TTL has
elapsed: it clears disposition, actor/client, source identity and lease. It
retains opaque receipt linkage, entity/ref/revision, terminal phase, frozen
descriptor and association evidence solely to prevent unsafe artifact cleanup.
No asset deletion/GC is implemented or authorized. Future GC must separately
prove terminal **unassociated** artifacts after reconciliation; age alone is
never proof, and associated assets must never be deleted by this maintenance.

Account and OAuth-client deletion retire stages immediately, including when
receipt expiry already cleared the receipt's actor/client columns. Independent
stage lifecycle identifiers make those triggers effective after expiry. Trusted
non-OAuth credential-deletion composition may call `retireClient(namespace)` to
redact receipt and retire stage arguments in one batch; this is not a tool/user
input endpoint. Do not globally retire the shared `gbfm:session` namespace for
one session/user deletion. P1 owns concrete first-party cleanup integration.

Activation still requires P1 to compose the services, wire both retention hooks
to existing maintenance, and prove each domain's authority/CAS and I1's real
fetch/PUT/verification/recovery flow. The fixture proves the shared D1 boundary,
not remote delivery or combined lane readiness. Fixed safe diagnostic categories
cover staged authorization/storage/cleanup failures without raw SQL/errors/data.
