import { PostId, PostVersion } from '@gbfm/core/editorial-mcp'
import {
  DraftMusicReferences,
  DraftMusicTarget,
  draftMusicTargetKey,
} from '@gbfm/core/post-music-references'
import { Schema } from 'effect'

import { CreateDraftInput, GetPostResult } from '../contracts'

/** Every editorial mutation retains the shipped caller-version/request identity contract. */
export const EditorialMutationFields = {
  requestId: CreateDraftInput.fields.requestId,
  postId: PostId,
  expectedVersion: PostVersion,
}

/** Attach an existing catalogue target at an explicit collection position; never import a URL. */
export const AttachMusicInput = Schema.Struct({
  ...EditorialMutationFields,
  target: DraftMusicTarget,
  position: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 49 })),
  primary: Schema.Boolean,
})

/** Removing a primary requires an explicit replacement or null, never automatic promotion. */
export const DetachMusicInput = Schema.Struct({
  ...EditorialMutationFields,
  target: DraftMusicTarget,
  primary: Schema.NullOr(DraftMusicTarget),
})

/** Offset counts UTF-16 code units in the saved source. Only paragraph boundaries are accepted. */
export const InsertMusicEmbedInput = Schema.Struct({
  ...EditorialMutationFields,
  target: DraftMusicTarget,
  offset: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100_000 })),
})

/** Replaces tags atomically with the post revision, preserving text and music associations. */
export const SetDraftTagsInput = Schema.Struct({
  ...EditorialMutationFields,
  tags: Schema.Array(
    Schema.NonEmptyString.check(
      Schema.isMaxLength(100),
      Schema.makeFilter((value) => value.trim() === value),
    ),
  ).check(
    Schema.isMaxLength(20),
    Schema.makeFilter((tags) => new Set(tags).size === tags.length),
  ),
})

/** Public display is stored in the original receipt, with subtraction-only masking on replay. */
export const DraftReferenceDisplay = Schema.TaggedUnion({
  Available: {
    target: DraftMusicTarget,
    title: Schema.String,
    artistNames: Schema.Array(Schema.String),
    coverImageUrl: Schema.NullOr(Schema.String),
  },
  Unavailable: { target: DraftMusicTarget },
})

/** Display order must match the authoritative ordered association identities. */
export const DraftReferenceRead = Schema.Struct({
  ...DraftMusicReferences.fields,
  display: Schema.Array(DraftReferenceDisplay).check(Schema.isMaxLength(50)),
}).check(
  Schema.makeFilter(
    (value) =>
      Schema.is(DraftMusicReferences)(value) &&
      value.references.length === value.display.length &&
      value.display.every((entry, index) => {
        const target = value.references[index]

        return (
          target !== undefined && draftMusicTargetKey(entry.target) === draftMusicTargetKey(target)
        )
      }),
  ),
)

/** Operation-specific output/receipt codec; never decode it with the legacy text-write result. */
export const ReferenceWriteResult = Schema.Struct({
  ...GetPostResult.fields,
  post: Schema.Struct({
    ...GetPostResult.fields.post.fields,
    musicReferences: DraftReferenceRead,
  }),
})
