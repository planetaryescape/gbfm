import { Api } from '@gbfm/api/api'
import type { MembershipMutationInput } from '@gbfm/api/favorites'
import { Data, Effect, Predicate, type Redacted } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'

export type FavoriteTrack = {
  readonly id: string
  readonly type: 'mix' | 'track' | 'misc'
  readonly slug: string
}

export type FavoritesConnection = {
  readonly httpClient: HttpClient.HttpClient
  readonly baseUrl: string
  readonly sessionToken: Redacted.Redacted
}

export class FavoriteSessionExpired extends Data.TaggedError('FavoriteSessionExpired') {}

export class FavoriteTrackUnavailable extends Data.TaggedError('FavoriteTrackUnavailable') {}

export class FavoriteRequestFailed extends Data.TaggedError('FavoriteRequestFailed') {}

export class FavoriteConflict extends Data.TaggedError('FavoriteConflict') {}

export type FavoriteError =
  | FavoriteSessionExpired
  | FavoriteTrackUnavailable
  | FavoriteRequestFailed
  | FavoriteConflict

const authorizedClient = (connection: FavoritesConnection) =>
  HttpClient.mapRequest(
    connection.httpClient,
    HttpClientRequest.bearerToken(connection.sessionToken),
  )

const toFavoriteError = (error: { readonly _tag: string }): FavoriteError => {
  if (Predicate.isTagged(error, 'NotFound')) return new FavoriteTrackUnavailable()

  if (Predicate.isTagged(error, 'Unauthorized') || Predicate.isTagged(error, 'Forbidden'))
    return new FavoriteSessionExpired()

  if (Predicate.isTagged(error, 'Conflict') || Predicate.isTagged(error, 'Gone'))
    return new FavoriteConflict()

  return new FavoriteRequestFailed()
}

/** State and owner revision are one observation, obtained before enabling the control. */
export const loadFavorite = Effect.fn('MobileFavorite.load')(function* (
  connection: FavoritesConnection,
  track: FavoriteTrack,
) {
  const favorites = yield* HttpApiClient.group(Api, {
    group: 'favorites',
    httpClient: authorizedClient(connection),
    baseUrl: connection.baseUrl,
  })

  const state = yield* favorites
    .getMembershipState({ params: { targetKind: 'audio', targetId: track.id } })
    .pipe(Effect.mapError(toFavoriteError))

  return { favorite: state.favorited, revision: state.revision }
})

export const saveFavorite = Effect.fn('MobileFavorite.save')(function* (
  connection: FavoritesConnection,
  track: FavoriteTrack,
  favorite: boolean,
  mutation: typeof MembershipMutationInput.Type,
) {
  const favorites = yield* HttpApiClient.group(Api, {
    group: 'favorites',
    httpClient: authorizedClient(connection),
    baseUrl: connection.baseUrl,
  })

  const result = yield* (
    favorite
      ? favorites.addFavorite({ payload: { ...mutation, audioId: track.id } })
      : favorites.removeFavorite({ params: { audioId: track.id }, payload: mutation })
  ).pipe(Effect.mapError(toFavoriteError))

  if (
    result.requestId !== mutation.requestId ||
    result.targetKind !== 'audio' ||
    result.targetId !== track.id ||
    result.desiredState !== favorite ||
    result.revision !== mutation.expectedRevision + 1
  )
    return yield* new FavoriteRequestFailed()

  return { favorite, revision: result.revision }
})
