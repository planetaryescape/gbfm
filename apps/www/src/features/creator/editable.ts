import { Match, Schema } from 'effect'

import { emptyDraft } from './domain'
import { CreatorIdentity, type CreatorKind, type EditableContent } from './services'

export const EditableResponse = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  updatedAt: Schema.toEncoded(Schema.DateFromString),
  title: Schema.NullOr(Schema.String),
  content: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  thumbnailUrl: Schema.NullOr(Schema.String),
  tags: Schema.NullOr(Schema.Array(Schema.String)),
  type: Schema.NullOr(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  creators: Schema.optional(Schema.Array(CreatorIdentity)),
  url: Schema.optional(Schema.String),
  musicEntityType: Schema.optional(Schema.NullOr(Schema.Literals(['album', 'track', 'playlist']))),
  musicEntityId: Schema.optional(Schema.NullOr(Schema.String)),
  quotedPostId: Schema.optional(Schema.NullOr(Schema.String)),
  showId: Schema.optional(Schema.NullOr(Schema.String)),
  episodeNumber: Schema.optional(Schema.NullOr(Schema.Number)),
})

export const editableDraft = (
  item: typeof EditableResponse.Type,
  kind: CreatorKind,
  slug: string,
  principalId: string,
): EditableContent => ({
  ...emptyDraft(kind, principalId, slug),
  kind: Match.value({ kind, type: item.type }).pipe(
    Match.when({ kind: 'mix' }, (): CreatorKind => 'mix'),
    Match.when({ type: 'post' }, (): CreatorKind => 'post'),
    Match.orElse((): CreatorKind => 'micro'),
  ),
  postId: kind === 'mix' ? undefined : item.id,
  expectedUpdatedAt: item.updatedAt,
  title: item.title ?? '',
  slug: item.slug,
  content: item.content ?? '',
  description: item.description ?? '',
  thumbnailUrl: item.thumbnailUrl ?? '',
  tags: item.tags ?? [],
  creatorIds: item.creators?.map(({ id }) => id) ?? [principalId],
  creators: item.creators ?? [],
  musicEntityType: item.musicEntityType ?? null,
  musicEntityId: item.musicEntityId ?? null,
  quotedPostId: item.quotedPostId ?? null,
  audioUrl: item.url ?? '',
  showId: item.showId ?? null,
  episodeNumber: item.episodeNumber ?? null,
  draft: item.draft ?? false,
})
