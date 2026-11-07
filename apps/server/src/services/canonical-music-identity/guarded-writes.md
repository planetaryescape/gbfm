# Guarded canonical writes — statement-only prerequisite

`canonicalMusicWriteStatements` prepares public metadata/artwork CAS statements
for the **same database** common atomic operation store. It does not execute them,
authorize an actor, admit a provider, persist source resolution/aliases/links, or
replace any legacy writer. The existing raw repository paths still leave an
all-writer revision gap until a separately allocated caller cutover lands.

## Inputs and composition

- Supply parsed, bounded, policy-selected current/desired public values, target
  type/id and its actual expected revision, pinned **before** provider work.
  Preserve canonical values unless an explicit overwrite selection allows change.
  These are trusted builder inputs, not a wire parser or a provider payload.
- Obtain a fresh `catalogue:write` checkpoint from P1's `CommandAuthority`.
  The immutable actor/client/resource namespace must match the original command.
  Pass its live SQL predicate; never substitute a constant or fabricated actor.
- Only the same-DB common store may supply `OperationContext`. Every root DML
  checks its pending receipt fence, live authority, observed values, target
  revision, and actual source fence. Dependent artist-name projections also
  check the physical root attempt marker and resulting revision.
- Source claims must still belong to this owner with an unexpired **DB-time**
  lease. Unowned sources must already resolve to this exact target. Normalized
  alias collisions exclude both owned and unowned sources. An empty source fence
  is ineligible. No claim is silently reacquired or rewritten by this builder.
- Use the returned statements and `assertApplied` in the atomic operation plan.
  Changed public fields advance revision once; a no-op still writes/proves this
  physical attempt marker without advancing revision or updatedAt. Capacity or
  alias failure cannot commit a partial fanout or successful receipt.

`parentWinner` alone is **not** a final authorization/source assertion.
`dependentFence`/`assertApplied` include the pending common fence and current
source lease. Completing a claim clears that lease, so do not append source
completion and blindly reuse the old final predicate. A future composition must
use the actual common `ctx.assert` to prove authority/source/root winner **before**
removing that evidence, fence every coupled DML, and prove the actual completed
source/alias/link state in its final assertion. This module supplies no completion
or staged-association plan; `ctx.assert` is atomic-pending-only.

## Required trusted intent and caller changes — proposal, not allocated cutover

Required intent: a stable genuine `OperationKey`, parsed normalized command
including source/overwrite selection, target type/id/expectedRevision pinned
before effects, and required fresh `CommandAuthority` checkpoints with immutable
actor/client/resource. A bounded cancellable read-only provider snapshot needs
explicit admission. There is no admitted transport in this layer.

On P1's named `aa3396668b79a6401cf21f68711933cf10e70091` ancestry, use truthful
`store.lookup` with fresh time, stable key, normalized intent and authorization.
Only an authorized **miss** permits admitted provider preparation outside SQL;
it is not a reservation. Execute with fresh time/authorization afterward. Never
run providers inside read-only `execute.prepare`, classify unavailable as miss,
or reserve work with an in-memory receipt.

Before shared cutover, owners must change:

1. P1 HTTP/music API/dashboard: rescrape calls carry explicit requestId and actual
   expectedRevision, with genuine request-scoped authority. Coordinate M1 intent
   overlap; no generated fallback IDs/revisions in handlers.
2. PL2/I1 background playlist enrichment/sync: receive a genuine persisted
   authorized per-item intent and recover real durable authority. The current
   fabricated `playlist_enrichment`/`playlist_sync` actor strings are not authority.
   Missing intent/authority/transport must fail typed unavailable **before** providers.
3. I1 canonical refresh/enrich: require that intent instead of actorId-only input;
   split provider preparation from guarded persistence and preserve original
   created/reused/partial semantics. Pure builders alone do not accomplish this.
4. I1 artwork association: retain the original revision across fetch/PUT; never
   rebase after upload. External storage/provider effects are not a DB transaction.
   Consume a separately approved staged association contract, not atomic ctx.assert.
5. P1 runtime: compose the actual same-DB store, authority and admitted transport.
   Queue/scheduler/worker activation and all production effects remain outside scope.

## Evidence boundary

Tests compose the exported builder with the actual common store and persisted
session authority on a fully migrated disposable Miniflare D1. They exercise
concurrency/discarded-response replay, changed-input conflict, pinned values and
revision, source lease/token/alias exclusion, resolved-source target exclusion,
session expiry after JS authorization, no-op revisions, root/fanout capacity,
artist alias conflict and ordered name projections. No provider or storage calls
are made; this is not runtime import, staged recovery or all-writer closure proof.
