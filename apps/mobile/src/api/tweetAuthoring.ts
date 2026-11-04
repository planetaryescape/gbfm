import { Api } from '@gbfm/api/api'
import { Effect, Predicate, Schema, type Redacted } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientError } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'

import { getTweetScreen } from '@/api/tweets'
import { draftError, postPayload, replyError, replyPayload, type TweetDraft } from '@/tweets/draft'
import { tagsLine } from '@/tweets/tagText'

export type AuthoringConnection = {
  readonly httpClient: HttpClient.HttpClient
  readonly baseUrl: string
  readonly sessionToken: Redacted.Redacted
}

export class TweetAuthoringFailed extends Schema.TaggedError<TweetAuthoringFailed>()(
  'TweetAuthoringFailed',
  { message: Schema.String },
) {}

export class TweetAuthoringUncertain extends Schema.TaggedError<TweetAuthoringUncertain>()(
  'TweetAuthoringUncertain',
  { message: Schema.String },
) {}

const failure = (cause: unknown) => {
  const status = HttpClientError.isHttpClientError(cause) ? cause.response?.status : undefined

  return Predicate.isTagged(cause, 'Forbidden') ||
    Predicate.isTagged(cause, 'Unauthorized') ||
    Predicate.isTagged(cause, 'BadRequest') ||
    Predicate.isTagged(cause, 'NotFound') ||
    Predicate.isTagged(cause, 'Conflict') ||
    Predicate.isTagged(cause, 'ValidationHttpError') ||
    (status !== undefined && [400, 401, 403, 404, 409, 422, 429].includes(status))
    ? new TweetAuthoringFailed({
        message: Predicate.isTagged(cause, 'Forbidden')
          ? 'Your account does not have permission to publish tweets.'
          : Predicate.isTagged(cause, 'Unauthorized')
            ? 'Your session expired. Sign in again. Your draft is saved on this device.'
            : 'Could not save your tweet. Your local draft is safe. Try again when you are connected.',
      })
    : new TweetAuthoringUncertain({
        message:
          'The connection or server failed before publication could be confirmed. Check whether your post or reply was published.',
      })
}

const authenticatedClient = (connection: AuthoringConnection) =>
  HttpClient.mapRequest(
    connection.httpClient,
    HttpClientRequest.bearerToken(connection.sessionToken),
  )

export const saveTweet = Effect.fn('saveTweet')(
  function* (
    connection: AuthoringConnection,
    draft: TweetDraft,
    publish: boolean,
    known: ReadonlyArray<string> = [],
  ) {
    const error = draftError(draft)

    if (error) return yield* new TweetAuthoringFailed({ message: error })

    const client = yield* HttpApiClient.group(Api, {
      group: 'post',
      baseUrl: connection.baseUrl,
      httpClient: authenticatedClient(connection),
    })

    const payload = postPayload(draft, publish, known)
    const update = () => client.updatePostBySlug({ params: { slug: draft.slug }, payload })

    if (draft.remote) return yield* update()

    return yield* client
      .createPost({ payload })
      .pipe(
        Effect.catchTag('Conflict', () =>
          client
            .getPostBySlugForEdit({ params: { slug: draft.slug } })
            .pipe(Effect.flatMap(() => update())),
        ),
      )
  },
  Effect.mapError((error) => (error instanceof TweetAuthoringFailed ? error : failure(error))),
)

export const publishReply = Effect.fn('publishReply')(
  function* (connection: AuthoringConnection, parentSlug: string, draft: TweetDraft) {
    const error = replyError(draft)

    if (error) return yield* new TweetAuthoringFailed({ message: error })

    const client = yield* HttpApiClient.group(Api, {
      group: 'post',
      baseUrl: connection.baseUrl,
      httpClient: authenticatedClient(connection),
    })

    return yield* client.createMicroPostReply({
      params: { parentSlug },
      payload: replyPayload(draft),
    })
  },
  Effect.mapError((error) =>
    error instanceof TweetAuthoringFailed
      ? error
      : Predicate.isTagged(error, 'NotFound')
        ? new TweetAuthoringFailed({ message: 'This tweet is no longer available to reply to.' })
        : failure(error),
  ),
)

export const resolveTweetMusic = Effect.fn('resolveTweetMusic')(
  function* (connection: AuthoringConnection, url: string) {
    const client = yield* HttpApiClient.group(Api, {
      group: 'music',
      baseUrl: connection.baseUrl,
      httpClient: authenticatedClient(connection),
    })

    const resolved = yield* client.resolveMusicEntity({
      payload: { url: url.trim(), origin: 'tweet' },
    })

    if (resolved.entityType === 'artist')
      return yield* new TweetAuthoringFailed({
        message: 'Attach an album, track or playlist, rather than an artist.',
      })

    return {
      entityType: resolved.entityType,
      entityId: resolved.entity.id,
      title: resolved.entity.title,
      url: url.trim(),
      coverImageUrl: resolved.coverImageUrl,
    }
  },
  Effect.mapError((error) =>
    error instanceof TweetAuthoringFailed
      ? error
      : new TweetAuthoringFailed({
          message: 'Could not attach this music link. Check the link and try again.',
        }),
  ),
)

const isMusicType = Schema.is(Schema.Literals(['album', 'track', 'playlist']))

export const loadTweetForEdit = Effect.fn('loadTweetForEdit')(
  function* (connection: AuthoringConnection, slug: string) {
    const client = yield* HttpApiClient.group(Api, {
      group: 'post',
      baseUrl: connection.baseUrl,
      httpClient: authenticatedClient(connection),
    })

    const post = yield* client.getPostBySlugForEdit({ params: { slug } })

    if (post.type !== 'micro')
      return yield* new TweetAuthoringFailed({ message: 'Only tweets can be edited here.' })

    const tags = post.tags ?? []
    const entityType = post.musicEntityType
    const entityId = post.musicEntityId

    const screenMusic =
      entityType && entityId
        ? yield* getTweetScreen(slug).pipe(
            Effect.map((screen) => screen.post.music ?? null),
            Effect.orElseSucceed(() => null),
          )
        : null

    const draft: TweetDraft = {
      slug: post.slug,
      text: [post.title, post.content, tagsLine(tags)]
        .flatMap((part) => (part?.trim() ? [part.trim()] : []))
        .join('\n\n'),
      remote: true,
      music:
        isMusicType(entityType) && entityId
          ? {
              entityType,
              entityId,
              title: screenMusic?.entity.title ?? 'Attached music',
              url: null,
              coverImageUrl: screenMusic?.entity.coverImageUrl ?? null,
            }
          : null,
      dismissedMusicUrl: null,
    }

    return { draft, tags, published: !post.draft }
  },
  Effect.mapError((error) =>
    error instanceof TweetAuthoringFailed
      ? error
      : Predicate.isTagged(error, 'NotFound') || Predicate.isTagged(error, 'Unauthorized')
        ? new TweetAuthoringFailed({ message: 'You can only edit your own tweets.' })
        : new TweetAuthoringFailed({ message: 'Could not load this tweet. Try again.' }),
  ),
)
