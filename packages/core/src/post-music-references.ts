import { Effect, Schema, flow } from 'effect'

const CatalogueId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
)

/** A stored catalogue identity, not a URL, import request or embed occurrence. */
export const DraftMusicTarget = Schema.Struct({
  entityType: Schema.Literals(['album', 'track', 'playlist']),
  entityId: CatalogueId,
})

/** A parsed album, track or playlist identity. */
export type DraftMusicTarget = typeof DraftMusicTarget.Type

/** Case-independent identity for comparison and operation hashing, without catalogue lookup. */
export const draftMusicTargetKey = (target: DraftMusicTarget): string =>
  `${target.entityType}:${target.entityId.toLowerCase()}`

const sameTarget = (left: DraftMusicTarget, right: DraftMusicTarget): boolean =>
  draftMusicTargetKey(left) === draftMusicTargetKey(right)

/** Ordered, distinct associations with an explicit optional member as primary. */
export const DraftMusicReferences = Schema.Struct({
  references: Schema.Array(DraftMusicTarget).check(Schema.isMaxLength(50)),
  primary: Schema.NullOr(DraftMusicTarget),
}).check(
  Schema.makeFilter(({ references, primary }) =>
    new Set(references.map(draftMusicTargetKey)).size === references.length &&
    (primary === null || references.some((target) => sameTarget(target, primary)))
      ? undefined
      : 'References must be distinct and primary must be a member',
  ),
)

/** A parsed replacement; empty references require an explicit null primary. */
export type DraftMusicReferences = typeof DraftMusicReferences.Type

/** Domain state reconstructed by persistence; managed is never inferred from row count. */
export const DraftMusicReferenceState = Schema.Struct({
  musicReferences: DraftMusicReferences,
  managed: Schema.Boolean,
})

/** Managed becomes true only after an explicit association edit commits. */
export type DraftMusicReferenceState = typeof DraftMusicReferenceState.Type

/** Typed invalid-input failure without including private boundary input. */
export class InvalidDraftMusicReferences extends Schema.TaggedError<
  InvalidDraftMusicReferences,
  { readonly brand: unique symbol }
>()('InvalidDraftMusicReferences', {
  code: Schema.Literal('invalid_input'),
  message: Schema.String,
}) {}

const invalidReferences = () =>
  new InvalidDraftMusicReferences({
    code: 'invalid_input',
    message: 'Invalid draft music references',
  })

/** Strictly decode a full replacement, including nested unknown-field rejection. */
export const parseDraftMusicReferences = flow(
  Schema.decodeUnknownEffect(DraftMusicReferences, { onExcessProperty: 'error' }),
  Effect.mapError(invalidReferences),
)

/** Internal changes; these do not add incremental MCP tools. Remove requires an explicit primary. */
export const DraftMusicReferenceChange = Schema.TaggedUnion({
  Replace: { musicReferences: DraftMusicReferences },
  Attach: {
    target: DraftMusicTarget,
    position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    primary: Schema.Boolean,
  },
  Remove: { target: DraftMusicTarget, primary: Schema.NullOr(DraftMusicTarget) },
  LegacyPrimary: { primary: Schema.NullOr(DraftMusicTarget) },
})

/** A parsed operation supplied by the browser or an owning application command. */
export type DraftMusicReferenceChange = typeof DraftMusicReferenceChange.Type

/**
 * Compute an association transition without I/O or input mutation. The application must validate
 * live catalogue access, freeze managed published posts, and persist this state with its post CAS.
 * Legacy primary selection preserves secondary order and never enables/resets managed state.
 */
export const transitionDraftMusicReferences = (
  state: DraftMusicReferenceState,
  change: DraftMusicReferenceChange,
): Effect.Effect<DraftMusicReferenceState, InvalidDraftMusicReferences> => {
  const current = state.musicReferences

  return DraftMusicReferenceChange.match(change, {
    Replace: (replacement) =>
      parseDraftMusicReferences(replacement.musicReferences).pipe(
        Effect.map((musicReferences) => ({ musicReferences, managed: true })),
      ),
    Attach: (change) => {
      if (
        !Number.isInteger(change.position) ||
        change.position < 0 ||
        change.position > current.references.length ||
        current.references.some((target) => sameTarget(target, change.target))
      )
        return Effect.fail(invalidReferences())

      return parseDraftMusicReferences({
        references: [
          ...current.references.slice(0, change.position),
          change.target,
          ...current.references.slice(change.position),
        ],
        primary: change.primary ? change.target : current.primary,
      }).pipe(Effect.map((musicReferences) => ({ musicReferences, managed: true })))
    },
    Remove: (change) => {
      if (!current.references.some((target) => sameTarget(target, change.target)))
        return Effect.fail(invalidReferences())

      return parseDraftMusicReferences({
        references: current.references.filter((target) => !sameTarget(target, change.target)),
        primary: change.primary,
      }).pipe(Effect.map((musicReferences) => ({ musicReferences, managed: true })))
    },
    LegacyPrimary: (change) => {
      const primary = change.primary

      const existing =
        primary === null
          ? undefined
          : current.references.find((target) => sameTarget(target, primary))

      return parseDraftMusicReferences({
        references:
          primary === null || existing !== undefined
            ? current.references
            : [...current.references, primary],
        primary: existing ?? primary,
      }).pipe(Effect.map((musicReferences) => ({ musicReferences, managed: state.managed })))
    },
  })
}
