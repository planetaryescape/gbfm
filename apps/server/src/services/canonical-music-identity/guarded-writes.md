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

## Additive trusted contract and exact coordinated cutover recipe

`contract.ts` now declares `CanonicalWriteIntent`,
`CanonicalReadOnlySnapshotProvider`, `GuardedRefreshMusicEntity` and
`CanonicalGuardedEntityOperations`. They are checked internal prerequisite types,
not installed adapters. Existing `RefreshMusicEntity`, service method signatures,
`buildEntityOperations` and its index.ts call remain unchanged: changing them
without P1's matching callers would break compilation or invite fake defaults.

The intended replacement signatures are precisely the two methods in
`CanonicalGuardedEntityOperations`:

```ts
refreshEntity(input: GuardedRefreshMusicEntity): Effect.Effect<
  OperationResult, MusicIdentityError | McpToolError
>
enrichEntity(input: GuardedRefreshMusicEntity): Effect.Effect<
  OperationResult, MusicIdentityError | McpToolError
>
```

The mandatory `intent` carries key, normalizedInput, checkpoint, parsed source
and typed target with expectedRevision/overwriteFields; it replaces actorId-only
input. Empty overwriteFields preserves public values. Original bounded receipt
projections replace fresh entity reads on replay; callers must handle every
OperationResult status rather than assume `.links` exists on all results.

For the matching orchestration patch, append a **required** canonical-write
dependency to `buildEntityOperations` containing the same-DB common operation
store, `CanonicalReadOnlySnapshotProvider`, and a fresh-time supplier. index.ts
must construct it from genuine composition, not the old raw scraper. Existing
attach/release/create/import dependencies and barrel exports are not allocated
for change. No provider dependency exists to wire today. Artwork policies other
than preserve additionally need the approved staged association capability;
otherwise the composed path must fail typed unavailable before providers.

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

1. P1 `packages/api/src/music.ts` rescrapeEntityLinks endpoint and its dashboard
   consumer: add required requestId + expectedRevision and explicit overwrite
   selection to the parsed request. `http/music.handlers.ts` rescrapeEntityLinks
   must construct the normalized intent from those fields, actual selected exact
   source and genuine request-scoped session authority. Preserve the API's bounded
   links response by mapping the original successful receipt projection, not a
   current reload; handle conflicts/denial/unavailability explicitly. Coordinate
   M1 intent overlap; no fallback IDs/revisions or fabricated OAuth clients.
2. PL2/I1 `playlist-tracks.service.ts` enrichTrackLinksEffect and
   syncPlaylistLinksEffect (and their owning enrichment/import entrypoints): receive a genuine persisted
   authorized per-item intent and recover real durable authority. The current
   fabricated `playlist_enrichment`/`playlist_sync` actor strings are not authority.
   Missing intent/authority/transport must fail typed unavailable **before** providers.
3. I1 `entity-operations.ts` refresh/enrich and the narrow index.ts
   buildEntityOperations call: require that intent/dependency instead of actorId-only input;
   split provider preparation from guarded persistence and preserve original
   created/reused/partial semantics. Pure builders alone do not accomplish this.
4. I1 artwork association: retain the original revision across fetch/PUT; never
   rebase after upload. External storage/provider effects are not a DB transaction.
   Consume a separately approved staged association contract, not atomic ctx.assert.
5. P1 runtime: compose the actual same-DB store, authority and admitted transport.
   Queue/scheduler/worker activation and all production effects remain outside scope.

These caller, dependency and guarded implementation changes must be adopted
atomically on a P1-named combined head. Until then, the additive types/builders
are obtainable but unused, legacy callers are unchanged, and missing-intent
fail-closed behavior is a required cutover contract, **not** implemented behavior.

## Evidence boundary

Tests compose the exported builder with the actual common store and persisted
session authority on a fully migrated disposable Miniflare D1. They exercise
concurrency/discarded-response replay, changed-input conflict, pinned values and
revision, source lease/token/alias exclusion, resolved-source target exclusion,
session expiry after JS authorization, no-op revisions, root/fanout capacity,
artist alias conflict and ordered name projections. No provider or storage calls
are made; this is not runtime import, staged recovery or all-writer closure proof.
