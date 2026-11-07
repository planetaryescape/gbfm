# Typed contract proposal

Status: design-only sketches for #517/#532. Names below are proposed, not existing exports. Storage and the 50-reference limit remain unapproved. No code or schema is added by this file.

## Domain value and parsing

TypeScript / Effect 4.0.6 conventions match the installed application. Reuse the existing `PostId`, `PostVersion`, catalogue UUID parser and rich-content `MusicEntityType` subset where accessible; do not create competing ID semantics. Existing API UUID parsing is case-insensitive and does not require version 4, so catalogue IDs must not use `isUUID(4)` (request IDs do).

```ts
import { Effect, Schema } from 'effect'
import { PostId, PostVersion } from '@gbfm/core/editorial-mcp'
// EditorialToolError and GetPostResult are existing local MCP schemas from contracts.ts.

// Sketch local to the owning domain module; export only what consumers need.
const CatalogueId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
)
const DraftMusicTarget = Schema.Struct({
  entityType: Schema.Literals(['album', 'track', 'playlist']),
  entityId: CatalogueId,
})
type DraftMusicTarget = typeof DraftMusicTarget.Type

const targetKey = (target: DraftMusicTarget) =>
  `${target.entityType}:${target.entityId.toLowerCase()}`
const sameTarget = (a: DraftMusicTarget, b: DraftMusicTarget) =>
  targetKey(a) === targetKey(b)

const DraftMusicReferences = Schema.Struct({
  references: Schema.Array(DraftMusicTarget).check(Schema.isMaxLength(50)),
  primary: Schema.NullOr(DraftMusicTarget),
}).check(
  Schema.makeFilter(({ references, primary }) =>
    new Set(references.map(targetKey)).size === references.length &&
    (primary === null || references.some((r) => sameTarget(r, primary)))
      ? undefined
      : 'Duplicate targets or primary not in reference list',
  ),
)
type DraftMusicReferences = typeof DraftMusicReferences.Type
```

Parse with `Schema.decodeUnknownEffect(..., { onExcessProperty: 'error' })` at JSON and storage boundaries. The pure target key normalizes UUID casing for equality and input hashing, before any catalogue lookup or receipt replay; replay must not depend on a fresh catalogue lookup. On a new write, require actual stored catalogue IDs (or a uniquely verified case-equivalent canonical UUID); never redirect a target through a new import or identity merge. Persist/return canonical stored spelling. Client IDs with different case cannot create two associations to one row. Missing primary is invalid in a replacement; explicit null is valid. Empty list requires null. Count is checked before DB work and again after canonical target verification. Do not accept captions, URLs, position numbers, snapshots, artist or label IDs in the mutation DTO.

## E3 input and public-interface mapping

Keep the selected capability `set_draft_music_references`. Do not extend the legacy `update_draft` input just to reuse its implementation. E1/E3 should share the domain save boundary, not expand legacy grants or change legacy tool meanings.

```ts
// PostId and PostVersion are existing @gbfm/core/editorial-mcp schemas.
const SetDraftMusicReferencesInput = Schema.Struct({
  requestId: Schema.String.check(Schema.isUUID(4)),
  postId: PostId,
  expectedVersion: PostVersion,
  musicReferences: DraftMusicReferences,
})
type SetDraftMusicReferencesInput = typeof SetDraftMusicReferencesInput.Type

// Additive HTTP draft-edit fields, not a new endpoint or second save backend.
const ReferencePatchFields = {
  musicReferences: Schema.optionalKey(DraftMusicReferences),
}
```

The MCP command always replaces the entire list and primary; omission of the field is invalid. Browser HTTP PATCH can omit it to preserve associations, replace it explicitly, or include it with text in one save. A reference-bearing browser edit requires the existing expected-updated-at precondition; a reference-only edit must not force content/title into the request. Reject simultaneous legacy primary-pair and collection fields rather than guessing intent. Reference-bearing creation can remain a separate create then set step in E3; do not extend `create_draft` or combine non-atomic creates under the name of one atomic command.

Input mapping:

| Surface | Input | Output / side effects |
| --- | --- | --- |
| `set_draft_music_references` | UUIDv4 request ID, post ID, expected version, complete collection | Applied draft projection + references; one guarded revision/receipt; no import or publication |
| Existing browser PATCH | Existing editable fields, expected updated-at; optional collection | Existing saved post with additive authorized reference projection; atomic combined save |
| Existing browser resolve / legacy primary pair | Existing explicit primary operation, expected revision | Add primary target if absent, otherwise retain its position; retain secondary associations. Clear primary does not clear collection. Existing provider-resolution authority remains separate; E3 never imports on lookup miss. |
| Existing `get_post` | Unchanged post ID input | Existing required fields/version; optional reference enrichment only under extra catalogue read authority, proposed owner-approved amendment required |

## Output and persisted state

```ts
type DraftReferenceDisplay =
  | {
      readonly _tag: 'Available'
      readonly target: DraftMusicTarget
      readonly title: string
      readonly artistNames: ReadonlyArray<string>
      readonly coverImageUrl: string | null // existing safe public projection only
    }
  | { readonly _tag: 'Unavailable'; readonly target: DraftMusicTarget }

type DraftReferenceRead = {
  readonly musicReferences: DraftMusicReferences & {
    readonly display: ReadonlyArray<DraftReferenceDisplay> // same order, bounded, no provider work
  }
}

// Schema values are not TypeScript value types; use the schema's decoded Type.
type ExistingPostResult = typeof GetPostResult.Type
type ReferenceWriteResult = ExistingPostResult & {
  readonly post: ExistingPostResult['post'] & DraftReferenceRead
}

// Proposed get_post-only result schema. Do not reuse it for legacy create/update receipts.
type GetPostWithReferencesResult = ExistingPostResult & {
  readonly post: ExistingPostResult['post'] & {
    readonly musicReferences?: DraftReferenceRead['musicReferences']
  }
}

type DraftReferenceState = {
  readonly postId: typeof PostId.Type
  readonly references: DraftMusicReferences
  // Post updatedAt and PostVersion remain on the owning post snapshot.
}
```

The result means the save committed; there is no accepted job, operation polling or async import. Retain endpoint identity, safe review URL, updated-at and version. Do not add P0's illustrative applied/accepted envelope to legacy editorial receipts. The new reference command stores its own authorized result through the existing receipt mechanism and replays that saved result. Keep the existing `GetPostResult` schema for legacy create/update result and receipt decoding. Do not broaden, replay-enrich or re-render old receipts as a side effect of a richer get_post read schema. Optional enrichment is a deliberate scope-dependent projection, not an unrestricted partial domain model.

Persist the target list/order/primary, not mutable display snapshots. A relational adapter maps rows/positions and legacy primary columns into `DraftReferenceState`; a JSON adapter decodes the same logical value. Reject corrupt persisted collections as unavailable/repair-required, never silently truncate, deduplicate or sort. Temporary target display unavailability is not the same as corrupt association identity. Target deletion must not create dangling rows; restrictive integrity or an approved atomic canonical replacement is an implementation gate.

## Owning service seam (illustrative, not an extra service framework)

```ts
type ReferenceCommandFailure = typeof EditorialToolError.Type // P1 owns its expanded schema

interface EditorialReferenceOperation {
  readonly setDraftMusicReferences: (
    input: SetDraftMusicReferencesInput,
  ) => Effect.Effect<ReferenceWriteResult, ReferenceCommandFailure>
}
```

Integrate this operation into E1's actual authored-post command seam. It can use the existing request-scoped actor service pattern; there is no new generic dispatcher, repository interface, provider adapter or duplicate receipt ledger. Resolve and parse external input at adapters. Validate references in domain/application code, then pass canonical values to the existing store.

The shared save input needs an explicit operation discriminator for receipt hashing (E1's existing equivalent preferred), the expected post state, optional authored field changes and optional collection replacement. `undefined` collection means preserve, not clear. This is patch semantics, not `Partial<InsertPost>` passed unchecked into a domain operation. Browser/session and PAT adapters keep their current credential-specific permissions; MCP requires the full P0 scope set.

## P0 reconciliation (approved design, not runtime authority)

Source: approved P0 D1–D6 and the reviewed prerequisite [contract document](../../docs/architecture/mcp-expanded-contracts.md) from PR #547, head `78701b3e52d4a4b64a2d66482c1f2a7d982c7f5a`. P4 adds no approval to that contract. PL1 #533 owns the proposed shared playlist visibility reconciliation: affected P4/E3 reads cannot enable before verified browser/API/embed/MCP consistency, and P1 must not implement an MCP-only filter as a substitute. Mixed role-ineligible grants fail as whole tokens at OAuth verification; per-tool filtering cannot repair them.

| Contract | P4 interpretation |
| --- | --- |
| Scopes | E3 requires **posts:read AND drafts:write AND catalogue:read**. No catalogue write/import/provider permission is implied. Existing text-only tools keep existing scopes. |
| Post access | Active eligible creator/editor/admin AND creator membership AND unpublished editorial draft; admin alone cannot bypass authorship. Check live persisted grant/account on invocation and replay. |
| Public music | Album/track `publishedAt` alone is not a privacy gate; use R1's approved public projection. Playlist must have non-null `publishedAt <= now`; no unpublished/future playlist even for admin on this draft operation. |
| Bounds | P0's JSON request/response cap is 256 KiB, with existing content field limits also applying. P4's 50-association maximum is still a separate proposal, not implicitly approved by P0's batch/list bound. One target hop, no recursive playlists/tracks expansion. |
| Retry identity | Preserve existing editorial actor/requestId receipt key; payload hash must distinguish the reference command from text/tag/embed operations. Do not adopt new-operation actor/client keys by silently changing existing editorial receipts. |
| Success | Explicit committed saved result, existing endpoint/version/review identity. No async accepted state is reachable. |
| Errors | Preserve access_denied, not_found, unavailable, conflict, invalid_input, expired; P1 owns expanded rate_limited and precondition_required where applicable. |

**Read-enrichment amendment requiring recorded owner approval:** P0 confirmed that the three scopes, visibility rules, unchanged legacy receipt keys and scope-independent version match approved D1–D6. P0 also confirmed that optional `get_post.musicReferences` is not covered by that approval, because existing editorial results were explicitly unchanged. Proposed amendment: keep `get_post` name/input/legacy required fields and `posts:read` admission; add optional `post.musicReferences` only with `catalogue:read`, subject to authored/public visibility. With authorized enrichment and no associations return `{ references: [], primary: null, display: [] }`; without catalogue authority omit the whole field, never return an empty collection as a substitute for denied enrichment. Version hashing remains independent of scopes, enrichment and display snapshots. No separate read tool is mandated. P1 must reserve the get_post result/model/tool-output schemas and use a distinct richer read result, leaving legacy create/update outputs and stored receipts unchanged. P0's recommendation is not owner approval for this amendment.

## Errors, retries and cancellation

| Condition | Result |
| --- | --- |
| Invalid/revoked bearer credential | Existing HTTP OAuth failure before tool execution |
| Live actor missing scope/role | access_denied; no writes or target disclosure |
| Other-owner/published/non-editorial/absent draft, hidden/absent submitted target | not_found under safe target policy, no disclosing which hidden row exists |
| Malformed/duplicate/nonmember primary/over limit/contradictory patch | invalid_input; no partial write |
| Expected version absent | precondition_required through P1 expanded boundary; legacy tool validation stays unchanged |
| Stale version or same receipt key with different payload | conflict; no automatic reload-and-overwrite |
| Receipt window expired | expired; no mutation with that key |
| Bounded capacity exhausted | rate_limited through P1; bounded retry delay |
| DB failure or corrupt stored value | unavailable; unknown post-commit outcomes are not labelled definitely-not-applied |

No automatic retry for denied/invalid/not-found/conflict/expired inputs. After transient or unknown mutation outcome retry only the identical request ID and payload. Receipt authorization includes current `catalogue:read` and current read eligibility for every target whose display appears in the stored result. A playlist that became private must not leak through a historical receipt: return safe not_found rather than replaying its old title/artwork. Reauthorize post state/ownership before replay, but do not re-run the mutation or substitute today's display snapshots for the original result. Legacy create/update receipts contain no new reference display and retain their existing checks. Cancellation before commit writes nothing where supported; disconnect after commit is recovered through the same receipt. Log safe operation/correlation/outcome only, not bodies, raw URLs, catalogue provenance or tokens.
