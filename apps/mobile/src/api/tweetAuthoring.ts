import { Api } from '@gbfm/api/api'
import { Effect, Predicate, Schema, type Redacted } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'

import { draftError, postPayload, type TweetDraft } from '@/tweets/draft'

export type AuthoringConnection = {
  readonly httpClient: HttpClient.HttpClient
  readonly baseUrl: string
  readonly sessionToken: Redacted.Redacted
}

export class TweetAuthoringFailed extends Schema.TaggedError<TweetAuthoringFailed>()(
  'TweetAuthoringFailed',
  { message: Schema.String },
) {}

const failure = (cause: unknown) =>
  new TweetAuthoringFailed({
    message: Predicate.isTagged(cause, 'Forbidden')
      ? 'Your account does not have permission to publish tweets.'
      : Predicate.isTagged(cause, 'Unauthorized')
        ? 'Your session expired. Sign in again. Your draft is saved on this device.'
        : 'Could not save your tweet. Your local draft is safe. Try again when you are connected.',
  })

const authenticatedClient = (connection: AuthoringConnection) =>
  HttpClient.mapRequest(
    connection.httpClient,
    HttpClientRequest.bearerToken(connection.sessionToken),
  )

export const saveTweet = Effect.fn('saveTweet')(
  function* (connection: AuthoringConnection, draft: TweetDraft, publish: boolean) {
    const error = draftError(draft)

    if (error) return yield* new TweetAuthoringFailed({ message: error })

    const client = yield* HttpApiClient.group(Api, {
      group: 'post',
      baseUrl: connection.baseUrl,
      httpClient: authenticatedClient(connection),
    })

    const payload = postPayload(draft, publish)
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
