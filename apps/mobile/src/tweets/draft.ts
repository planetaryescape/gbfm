import { Effect, Schema } from 'effect'

import { extractTags, stripTags, tidyText } from './tagText'

export const TWEET_MAX_LENGTH = 280

export const CONTENT_MAX_LENGTH = 64 * 1024

const LINK_WEIGHT = 23

const MusicAttachment = Schema.Struct({
  entityType: Schema.Literals(['album', 'track', 'playlist']),
  entityId: Schema.String,
  title: Schema.String,
  url: Schema.NullOr(Schema.String),
  coverImageUrl: Schema.NullOr(Schema.String),
})

export type MusicAttachment = typeof MusicAttachment.Type

export const TweetDraft = Schema.Struct({
  slug: Schema.NonEmptyString,
  text: Schema.String,
  remote: Schema.Boolean,
  music: Schema.NullOr(MusicAttachment),
  dismissedMusicUrl: Schema.NullOr(Schema.String),
})

export type TweetDraft = typeof TweetDraft.Type

const LegacyTweetDraft = Schema.Struct({
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

type LegacyTweetDraft = typeof LegacyTweetDraft.Type

export const StoredTweetDraft = Schema.Union([TweetDraft, LegacyTweetDraft])

const fromLegacy = (legacy: LegacyTweetDraft): TweetDraft => {
  const hashtags = legacy.tags
    .split(',')
    .map((tag) => tag.trim().replaceAll(/\s+/g, ''))
    .filter((tag) => tag.length > 0)
    .map((tag) => `#${tag}`)
    .join(' ')

  return {
    slug: legacy.slug,
    text: [legacy.title, legacy.content, hashtags].filter((part) => part.trim()).join('\n\n'),
    remote: legacy.remote,
    music: legacy.music ? { ...legacy.music, url: null, coverImageUrl: null } : null,
    dismissedMusicUrl: null,
  }
}

export const normalizeStoredDraft = (stored: typeof StoredTweetDraft.Type): TweetDraft =>
  'text' in stored ? stored : fromLegacy(stored)

export const emptyTweetDraft = (id: string): TweetDraft => ({
  slug: `mobile-${id}`,
  text: '',
  remote: false,
  music: null,
  dismissedMusicUrl: null,
})

const linkPattern = /https?:\/\/[^\s<>"'`)\]}]+/g

const trimLink = (link: string) => link.replace(/[.,;!?]+$/, '')

export const extractLinks = (text: string) =>
  [...text.matchAll(linkPattern)].map(([link]) => trimLink(link))

export const tweetLength = (text: string) =>
  text.trim().replaceAll(linkPattern, 'x'.repeat(LINK_WEIGHT)).length

export const musicCandidate = (draft: TweetDraft) => {
  const link = extractLinks(draft.text)[0] ?? null

  return link && link !== draft.dismissedMusicUrl && link !== draft.music?.url ? link : null
}

export const withText = (draft: TweetDraft, text: string): TweetDraft => {
  const links = extractLinks(text)
  const music = draft.music?.url && !links.includes(draft.music.url) ? null : draft.music

  const dismissedMusicUrl =
    draft.dismissedMusicUrl && links.includes(draft.dismissedMusicUrl)
      ? draft.dismissedMusicUrl
      : null

  return { ...draft, text, music, dismissedMusicUrl }
}

export const tweetContent = (draft: TweetDraft) => {
  const body = stripTags(draft.text)
  const link = draft.music?.url

  if (!link) return body
  const withoutLink = tidyText(body.split(link).join(''))

  return withoutLink || body
}

export const draftError = (draft: TweetDraft): string | null => {
  if (!tweetContent(draft)) return 'Write something besides tags.'

  if (tweetLength(draft.text) > TWEET_MAX_LENGTH)
    return `Keep it to ${TWEET_MAX_LENGTH} characters.`

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

export const appendSharedText = (draft: TweetDraft, text: string): TweetDraft =>
  withText(draft, [draft.text.trim(), text].filter((value) => value.length > 0).join('\n\n'))

export const postPayload = (
  draft: TweetDraft,
  publish: boolean,
  known: ReadonlyArray<string> = [],
) => ({
  type: 'micro' as const,
  slug: draft.slug,
  title: null,
  content: tweetContent(draft) || null,
  tags: extractTags(draft.text, known),
  draft: !publish,
  musicEntityType: draft.music?.entityType ?? null,
  musicEntityId: draft.music?.entityId ?? null,
})

export const replyContent = (draft: TweetDraft) => {
  const body = tidyText(draft.text)
  const link = draft.music?.url

  if (!link) return body

  return tidyText(body.split(link).join('')) || body
}

export const replyError = (draft: TweetDraft): string | null => {
  if (!replyContent(draft)) return 'Write a reply.'

  if (tweetLength(draft.text) > TWEET_MAX_LENGTH)
    return `Keep it to ${TWEET_MAX_LENGTH} characters.`

  return null
}

export const replyPayload = (draft: TweetDraft) => ({
  content: replyContent(draft),
  musicEntityType: draft.music?.entityType ?? null,
  musicEntityId: draft.music?.entityId ?? null,
})
