import { Effect, Schema } from 'effect'

export const TWEET_MAX_LENGTH = 255

export const CONTENT_MAX_LENGTH = 64 * 1024

export const TweetDraft = Schema.Struct({
  slug: Schema.NonEmptyString,
  title: Schema.String,
  content: Schema.String,
  tags: Schema.String,
  remote: Schema.Boolean,
  music: Schema.NullOr(
    Schema.Struct({
      entityType: Schema.Literals(['album', 'track', 'playlist']),
      entityId: Schema.String,
      title: Schema.String,
    }),
  ),
})

export type TweetDraft = typeof TweetDraft.Type

export const emptyTweetDraft = (id: string): TweetDraft => ({
  slug: `mobile-${id}`,
  title: '',
  content: '',
  tags: '',
  remote: false,
  music: null,
})

export const draftError = (draft: TweetDraft): string | null => {
  if (!draft.title.trim() && !draft.content.trim()) return 'Write a tweet or add some content.'

  if (draft.title.length > TWEET_MAX_LENGTH)
    return 'Keep the tweet to 255 characters. Use the body for more.'

  if (draft.content.length > CONTENT_MAX_LENGTH) return 'The body is too long. Keep it under 64 KB.'

  return null
}

export class SharedContentInvalid extends Schema.TaggedError<SharedContentInvalid>()(
  'SharedContentInvalid',
  { message: Schema.String },
) {}

const SharedPayloads = Schema.Array(
  Schema.Struct({
    shareType: Schema.Literals(['text', 'url']),
    value: Schema.String,
  }),
)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser is the native share-payload boundary; decoding unknown data is its contract.
export const parseSharedText = (input: unknown) =>
  Schema.decodeUnknownEffect(SharedPayloads)(input).pipe(
    Effect.mapError(
      () =>
        new SharedContentInvalid({
          message:
            'Share text or web links to write a tweet. Files and photos are not supported yet.',
        }),
    ),
    Effect.flatMap((items) => {
      const text = [
        ...new Set(items.map(({ value }) => value.trim()).filter((value) => value.length > 0)),
      ].join('\n\n')

      if (!text)
        return Effect.fail(new SharedContentInvalid({ message: 'No text or link was shared.' }))

      if (text.length > CONTENT_MAX_LENGTH)
        return Effect.fail(
          new SharedContentInvalid({
            message: 'This share is too long. Share a shorter selection or a link instead.',
          }),
        )

      return Effect.succeed(text)
    }),
  )

export const appendSharedText = (draft: TweetDraft, text: string): TweetDraft => {
  if (!draft.title && !draft.content && text.length <= TWEET_MAX_LENGTH)
    return { ...draft, title: text }

  return {
    ...draft,
    content: [draft.content, text].filter((value) => value.length > 0).join('\n\n'),
  }
}

export const postPayload = (draft: TweetDraft, publish: boolean) => ({
  type: 'micro' as const,
  slug: draft.slug,
  title: draft.title.trim() || null,
  content: draft.content.trim() || null,
  tags: [
    ...new Set(
      draft.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ),
  ],
  draft: !publish,
  musicEntityType: draft.music?.entityType ?? null,
  musicEntityId: draft.music?.entityId ?? null,
})
