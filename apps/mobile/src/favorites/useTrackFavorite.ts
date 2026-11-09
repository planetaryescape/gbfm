import { Effect, Fiber, Predicate, Redacted } from 'effect'
import { randomUUID } from 'expo-crypto'
import { type Dispatch, type RefObject, useCallback, useEffect, useReducer, useRef } from 'react'

import { getHttpClient } from '@/api/client'
import {
  FavoriteRequestFailed,
  loadFavorite,
  saveFavorite,
  type FavoriteError,
  type FavoriteTrack,
  type FavoritesConnection,
} from '@/api/favorites'
import { env } from '@/env'
import { useAuthStore } from '@/store/auth'

import { dismissFavoriteNoticeAfterDelay } from './favoriteNotice'
import {
  canSave,
  FavoriteEvent,
  favoriteKey,
  FavoriteStatus,
  initialFavoriteState,
  reduceFavorite,
  statusFor,
  trackFavoriteFor,
} from './favoriteState'

const REQUEST_TIMEOUT = '15 seconds'

const connect = (sessionToken: string) =>
  getHttpClient.pipe(
    Effect.map((httpClient): FavoritesConnection => ({
      httpClient,
      baseUrl: env.EXPO_PUBLIC_API_URL,
      sessionToken: Redacted.make(sessionToken),
    })),
    Effect.mapError(() => new FavoriteRequestFailed()),
  )

const withConnection = <A>(
  sessionToken: string,
  request: (connection: FavoritesConnection) => Effect.Effect<A, FavoriteError>,
) =>
  connect(sessionToken).pipe(
    Effect.flatMap(request),
    Effect.timeoutOrElse({
      duration: REQUEST_TIMEOUT,
      orElse: () => Effect.fail(new FavoriteRequestFailed()),
    }),
  )

const forkLoad = (
  dispatch: Dispatch<FavoriteEvent>,
  key: string,
  sessionToken: string,
  track: FavoriteTrack,
  observed: RefObject<ObservedMembership | null>,
) => {
  dispatch(FavoriteEvent.LoadStarted({ key }))

  return Effect.runFork(
    withConnection(sessionToken, (connection) => loadFavorite(connection, track)).pipe(
      Effect.match({
        onSuccess: ({ favorite, revision }) => {
          observed.current = { key, revision, requestId: null }
          dispatch(FavoriteEvent.Loaded({ key, favorite }))
        },
        onFailure: (error) => dispatch(FavoriteEvent.Failed({ key, error })),
      }),
    ),
  )
}

const interrupt = (fiber: Fiber.Fiber<unknown, unknown> | null | undefined) => {
  if (fiber) Effect.runFork(Fiber.interrupt(fiber))
}

type PendingSave = {
  readonly key: string
  readonly owner: symbol
  readonly fiber: Fiber.Fiber<void> | null
}

type ObservedMembership = {
  readonly key: string
  readonly revision: number
  readonly requestId: string | null
}

export function useTrackFavorite(track: FavoriteTrack) {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const sessionToken = useAuthStore((state) => state.sessionToken)
  const [state, dispatch] = useReducer(reduceFavorite, '', initialFavoriteState)
  const loadFiber = useRef<Fiber.Fiber<void> | null>(null)
  const pendingSave = useRef<PendingSave | null>(null)
  const observed = useRef<ObservedMembership | null>(null)

  const { id: trackId, type: trackType, slug: trackSlug } = track
  const key = accountId && sessionToken ? favoriteKey(accountId, trackId) : null
  const status = key ? statusFor(state, key) : null
  const notice = state.key === key ? state.notice : null

  useEffect(() => {
    if (!notice || !key) return undefined

    const timer = Effect.runFork(
      dismissFavoriteNoticeAfterDelay(key, notice).pipe(
        Effect.tap((event) => Effect.sync(() => dispatch(event))),
      ),
    )

    return () => interrupt(timer)
  }, [key, notice])

  useEffect(() => {
    if (!key || !sessionToken) return undefined

    loadFiber.current = forkLoad(
      dispatch,
      key,
      sessionToken,
      {
        id: trackId,
        type: trackType,
        slug: trackSlug,
      },
      observed,
    )

    return () => {
      interrupt(loadFiber.current)
      interrupt(pendingSave.current?.fiber)
      loadFiber.current = null
      pendingSave.current = null
      observed.current = null
    }
  }, [key, sessionToken, trackId, trackType, trackSlug])

  const press = useCallback(() => {
    if (!key || !sessionToken || !status) return

    if (FavoriteStatus.$is('LoadFailed')(status)) {
      interrupt(loadFiber.current)
      loadFiber.current = forkLoad(dispatch, key, sessionToken, track, observed)

      return
    }

    if (!canSave(status) || pendingSave.current?.key === key) return
    const observation = observed.current

    if (!observation || observation.key !== key) return

    const target = !status.favorite

    const mutation = {
      requestId: observation.requestId ?? randomUUID(),
      expectedRevision: observation.revision,
    }

    observed.current = { ...observation, requestId: mutation.requestId }
    const owner = Symbol('favorite-save')
    pendingSave.current = { key, owner, fiber: null }
    dispatch(FavoriteEvent.SaveStarted({ key }))

    const fiber = Effect.runFork(
      withConnection(sessionToken, (connection) =>
        saveFavorite(connection, track, target, mutation),
      ).pipe(
        Effect.match({
          onSuccess: ({ favorite, revision }) => {
            observed.current = { key, revision, requestId: null }
            dispatch(FavoriteEvent.Saved({ key, favorite }))
          },
          onFailure: (error) => {
            if (Predicate.isTagged(error, 'FavoriteConflict')) {
              observed.current = null
              loadFiber.current = forkLoad(dispatch, key, sessionToken, track, observed)
            } else dispatch(FavoriteEvent.Failed({ key, error }))
          },
        }),
        Effect.ensuring(
          Effect.sync(() => {
            if (pendingSave.current?.owner === owner) pendingSave.current = null
          }),
        ),
      ),
    )

    if (pendingSave.current?.owner === owner) pendingSave.current = { key, owner, fiber }
  }, [key, sessionToken, track, status])

  const favorite = trackFavoriteFor(status)

  return { favorite, press, notice }
}
