import { Api } from '@gbfm/api/api'
import { Data, Effect, Predicate, type Redacted } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'

export type ReaderConnection = {
  readonly httpClient: HttpClient.HttpClient
  readonly baseUrl: string
  readonly sessionToken: Redacted.Redacted | null
}

export class TweetReaderUnavailable extends Data.TaggedError('TweetReaderUnavailable') {}

const requestFailed = () => new TweetReaderUnavailable()

const clientFor = (connection: ReaderConnection) =>
  connection.sessionToken
    ? HttpClient.mapRequest(
        connection.httpClient,
        HttpClientRequest.bearerToken(connection.sessionToken),
      )
    : connection.httpClient

const navigation = (connection: ReaderConnection) =>
  HttpApiClient.group(Api, {
    group: 'navigation',
    baseUrl: connection.baseUrl,
    httpClient: clientFor(connection),
  })

export const loadReaderPost = (connection: ReaderConnection, slug: string | null) =>
  Effect.gen(function* () {
    const posts = yield* HttpApiClient.group(Api, {
      group: 'post',
      baseUrl: connection.baseUrl,
      httpClient: clientFor(connection),
    })

    const target = slug ?? (yield* posts.getLatestMicroPost())?.slug

    if (!target) return null

    return yield* posts.getMicroPostScreen({ params: { slug: target }, query: {} })
  }).pipe(Effect.mapError(requestFailed))

export const loadReaderNavigation = (connection: ReaderConnection, slug: string) =>
  Effect.gen(function* () {
    const client = yield* navigation(connection)

    return yield* client.getMicroPostNeighbours({ params: { slug } })
  }).pipe(Effect.mapError(requestFailed))

export const recordReaderVisit = (connection: ReaderConnection, slug: string) =>
  Effect.gen(function* () {
    const client = yield* navigation(connection)
    const result = yield* client.markMicroPostSeen({ params: { slug } })

    if (!result.recorded) return yield* new TweetReaderUnavailable()

    return undefined
  }).pipe(Effect.mapError(requestFailed))

export const randomReaderPost = (connection: ReaderConnection, slug: string) =>
  Effect.gen(function* () {
    const client = yield* navigation(connection)

    return yield* client.getRandomUnreadMicroPost({ params: { slug } }).pipe(
      Effect.map((result) => result.slug),
      Effect.catch((error) =>
        Predicate.isTagged(error, 'NotFound') ? Effect.succeed(null) : Effect.fail(error),
      ),
    )
  }).pipe(Effect.mapError(requestFailed))

export const resetReaderHistory = (connection: ReaderConnection) =>
  Effect.gen(function* () {
    const client = yield* navigation(connection)
    const result = yield* client.resetReadingHistory()

    if (!result.reset) return yield* new TweetReaderUnavailable()

    return undefined
  }).pipe(Effect.mapError(requestFailed))
