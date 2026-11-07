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
  `AtomicOperationPlan`, `ExecuteOperation`, `OperationResult`.

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
expiresAt}`. Failures contain only `status`: `conflict`, `expired`,
`access_denied`, `invalid_input`, `unavailable`. Times are epoch milliseconds.
`unavailable` is ambiguous, **not** proof of rollback; retry the same key/input.
Postcommit access loss can return denial after a successful mutation. A later
authorized same-key retry recovers the saved result.

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
Private result fields still require current read authority. No generic receipt
lookup or handle-based private result endpoint exists here.

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
