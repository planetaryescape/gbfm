import { PostId, PostVersion } from '@gbfm/core/editorial-mcp'
import { Schema } from 'effect'

import { EndpointIdentity, EditorialReviewUrl } from '../contracts'

/** Persisted creator revision; timestamps are not concurrency tokens. */
export const CreatorRevision = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
)

const RequestId = Schema.String.check(Schema.isUUID(4))

const ContentId = Schema.String.check(Schema.isUUID())

const Title = Schema.NonEmptyString.check(
  Schema.isMaxLength(300),
  Schema.makeFilter((value) => value.trim().length > 0),
)

const Description = Schema.NullOr(Schema.String.check(Schema.isMaxLength(20_000)))

const CreatorKind = Schema.Literals(['mix', 'show'])

/** Enumerates only the actor's unpublished mixes/shows, never an admin-wide view. */
export const ListCreatorDraftsInput = Schema.Struct({
  kind: Schema.optionalKey(CreatorKind),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }))),
})

/** Explicit metadata allowlist: no owner, media, body, tags or publication fields. */
export const UpdateCreatorMetadataInput = Schema.Struct({
  requestId: RequestId,
  kind: CreatorKind,
  targetId: ContentId,
  expectedRevision: CreatorRevision,
  title: Schema.optionalKey(Title),
  description: Schema.optionalKey(Description),
}).check(Schema.makeFilter((input) => input.title !== undefined || input.description !== undefined))

/** Public micro creation is separately consented, not a draft-write operation. */
export const CreateMicroPostInput = Schema.Struct({
  requestId: RequestId,
  title: Schema.optionalKey(Title),
  content: Schema.NonEmptyString.check(Schema.isMaxLength(100_000)),
})

/** A reply accepts a canonical parent ID; callers cannot choose thread roots/depth. */
export const ReplyToMicroPostInput = Schema.Struct({
  ...CreateMicroPostInput.fields,
  parentPostId: PostId,
})

/** Publishing editorial content is an explicit version-bound transition. */
export const PublishEditorialInput = Schema.Struct({
  requestId: RequestId,
  postId: PostId,
  expectedVersion: PostVersion,
})

const ExistingTarget = Schema.Union([
  Schema.Struct({
    kind: Schema.Literals(['post', 'micro']),
    targetId: PostId,
    expectedVersion: PostVersion,
  }),
  Schema.Struct({
    kind: CreatorKind,
    targetId: ContentId,
    expectedRevision: CreatorRevision,
  }),
])

/** Unpublish requires the target's write scope as well as content:publish. */
export const UnpublishContentInput = Schema.Struct({
  requestId: RequestId,
  target: ExistingTarget,
})

/** Delete is separate consent, with no implicit cascade or media-byte revocation. */
export const DeleteContentInput = Schema.Struct({
  requestId: RequestId,
  target: ExistingTarget,
})

/** Draft metadata projection deliberately excludes bodies, assets and creator graphs. */
export const ListCreatorDraftsResult = Schema.Struct({
  endpoint: EndpointIdentity,
  drafts: Schema.Array(
    Schema.Struct({
      kind: CreatorKind,
      targetId: ContentId,
      title: Schema.String.check(Schema.isMaxLength(300)),
      description: Description,
      revision: CreatorRevision,
      updatedAt: Schema.String,
      reviewUrl: EditorialReviewUrl,
    }),
  ).check(Schema.isMaxLength(50)),
  pagination: Schema.Struct({
    limit: Schema.Int,
    offset: Schema.Int,
    hasMore: Schema.Boolean,
  }),
})

/** Saved acknowledgements contain no private body or asset that replay could disclose. */
export const CreatorCommandResult = Schema.Struct({
  endpoint: EndpointIdentity,
  status: Schema.Literal('applied'),
  replayed: Schema.Boolean,
  target: Schema.Union([
    Schema.Struct({
      kind: Schema.Literals(['post', 'micro']),
      targetId: PostId,
      version: PostVersion,
      state: Schema.Literals(['published', 'unpublished', 'deleted']),
    }),
    Schema.Struct({
      kind: CreatorKind,
      targetId: ContentId,
      revision: CreatorRevision,
      state: Schema.Literals(['unpublished', 'deleted']),
    }),
  ]),
})
