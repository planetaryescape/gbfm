import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { Effect, Redacted } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { useFocusEffect } from 'expo-router'
import { type Dispatch, useCallback, useEffect, useReducer, useRef, useState } from 'react'

import { getHttpClient } from '@/api/client'
import {
  loadReaderNavigation,
  loadReaderPost,
  randomReaderPost,
  recordReaderVisit,
  resetReaderHistory,
  type ReaderConnection,
  TweetReaderUnavailable,
} from '@/api/tweetReader'
import { env } from '@/env'

import { readerCache, type ReaderCache } from './readerCache'
import { readReaderPosition, saveReaderPosition } from './readerPosition'
import { initialReaderState, readerAcceptsAction, ReaderEvent, reduceReader } from './readerState'

export const checkpoints = Atom.make<Readonly<Record<string, string>>>({}).pipe(Atom.keepAlive)

const bounded = <A, E>(work: Effect.Effect<A, E>) =>
  work.pipe(
    Effect.timeoutOrElse({
      duration: '15 seconds',
      orElse: () => Effect.fail(new TweetReaderUnavailable()),
    }),
  )

export const readerConnection = (sessionToken: string | null) =>
  getHttpClient.pipe(
    Effect.map((httpClient): ReaderConnection => ({
      httpClient,
      baseUrl: env.EXPO_PUBLIC_API_URL,
      sessionToken: sessionToken ? Redacted.make(sessionToken) : null,
    })),
    Effect.mapError(() => new TweetReaderUnavailable()),
  )

const prefetch = (connection: ReaderConnection, cache: ReaderCache, slugs: ReadonlyArray<string>) =>
  Effect.forEach(
    slugs,
    (slug) =>
      Effect.all(
        [
          cache.hasScreen(slug)
            ? Effect.void
            : loadReaderPost(connection, slug).pipe(
                Effect.tap((screen) => Effect.sync(() => screen && cache.warmScreen(screen))),
              ),
          cache.neighbours(slug)
            ? Effect.void
            : loadReaderNavigation(connection, slug).pipe(
                Effect.tap((value) => Effect.sync(() => cache.storeNeighbours(slug, value))),
              ),
        ],
        { concurrency: 'unbounded', discard: true },
      ).pipe(bounded, Effect.ignore),
    { concurrency: 'unbounded', discard: true },
  )

const loadVisit = (input: {
  readonly sessionToken: string | null
  readonly slug: string | null
  readonly request: number
  readonly cache: ReaderCache
  readonly dispatch: Dispatch<ReaderEvent>
  readonly remember: (slug: string) => void
}) =>
  bounded(readerConnection(input.sessionToken)).pipe(
    Effect.flatMap((connection) =>
      Effect.gen(function* () {
        const { cache, request, dispatch } = input
        const cached = input.slug ? cache.screen(input.slug) : undefined
        const cachedNavigation = input.slug ? cache.neighbours(input.slug) : undefined

        if (cached) dispatch(ReaderEvent.Loaded({ request, screen: cached }))

        if (cachedNavigation)
          dispatch(ReaderEvent.Navigation({ request, navigation: cachedNavigation }))

        const load = bounded(loadReaderPost(connection, input.slug))

        const screen = yield* cached ? load.pipe(Effect.catch(() => Effect.succeed(cached))) : load

        dispatch(ReaderEvent.Loaded({ request, screen }))

        if (!screen) return

        cache.storeScreen(screen)
        const current = screen.post.slug
        input.remember(current)
        yield* bounded(recordReaderVisit(connection, current)).pipe(
          Effect.match({
            onSuccess: () => dispatch(ReaderEvent.Progress({ request, failed: false })),
            onFailure: () => dispatch(ReaderEvent.Progress({ request, failed: true })),
          }),
        )

        const navigation = yield* bounded(loadReaderNavigation(connection, current)).pipe(
          Effect.match({
            onSuccess: (value) => {
              cache.storeNeighbours(current, value)
              dispatch(ReaderEvent.Navigation({ request, navigation: value }))

              return value
            },
            onFailure: () => {
              if (!cachedNavigation) dispatch(ReaderEvent.NavigationFailed({ request }))

              return cachedNavigation ?? null
            },
          }),
        )

        if (navigation)
          yield* prefetch(
            connection,
            cache,
            [navigation.older, navigation.newer].flatMap((slug) => (slug ? [slug] : [])),
          )
      }),
    ),
    Effect.catch(() =>
      Effect.sync(() => input.dispatch(ReaderEvent.Failed({ request: input.request }))),
    ),
  )

export function useTweetReader(
  identity: string,
  sessionToken: string | null,
  initialSlug?: string,
) {
  const saved = useAtomValue(checkpoints)
  const remember = useAtomSet(checkpoints)

  const [target, setTarget] = useState({
    slug: initialSlug ?? saved[identity] ?? readReaderPosition(identity),
    revision: 0,
  })

  const savedRef = useRef(saved)
  useEffect(() => {
    savedRef.current = saved
  }, [saved])
  const lastTarget = useRef<typeof target | null>(null)

  const [state, dispatch] = useReducer(reduceReader, initialReaderState)
  const sequence = useRef(0)
  const focused = useRef(false)
  const action = useRef<AbortController | null>(null)

  useFocusEffect(
    useCallback(() => {
      const resuming = lastTarget.current === target
      lastTarget.current = target

      const resumedSlug =
        !initialSlug && resuming ? (savedRef.current[identity] ?? target.slug) : target.slug

      if (resumedSlug !== target.slug) {
        setTarget((previous) => ({ slug: resumedSlug, revision: previous.revision + 1 }))

        return undefined
      }

      focused.current = true
      const controller = new AbortController()
      const request = ++sequence.current
      action.current?.abort()
      action.current = null
      dispatch(ReaderEvent.Started({ request }))

      const load = loadVisit({
        sessionToken,
        slug: target.slug,
        request,
        cache: readerCache(identity),
        dispatch,
        remember: (current) => {
          saveReaderPosition(identity, current)
          remember((positions) => ({ ...positions, [identity]: current }))
        },
      })

      const pending = Effect.runPromise(load, { signal: controller.signal })
      pending.catch(() => {
        if (!controller.signal.aborted) dispatch(ReaderEvent.Failed({ request }))
      })

      return () => {
        focused.current = false
        controller.abort()
        const pendingAction = action.current
        action.current = null
        pendingAction?.abort()
      }
    }, [identity, sessionToken, initialSlug, target, remember]),
  )

  const go = (target: string | null) => {
    action.current?.abort()
    setTarget((previous) => ({ slug: target, revision: previous.revision + 1 }))
  }

  const runAction = (kind: 'random' | 'reset') => {
    if (
      !readerAcceptsAction(state, sequence.current, focused.current) ||
      action.current ||
      !state.screen
    )
      return

    const controller = new AbortController()
    action.current = controller
    const request = sequence.current
    const current = state.screen.post.slug
    dispatch(ReaderEvent.Action({ request, busy: true }))

    const work = readerConnection(sessionToken).pipe(
      Effect.flatMap((connection) =>
        kind === 'reset'
          ? resetReaderHistory(connection).pipe(Effect.as(null))
          : randomReaderPost(connection, current),
      ),
      Effect.timeoutOrElse({
        duration: '15 seconds',
        orElse: () => Effect.fail(new TweetReaderUnavailable()),
      }),
      Effect.match({
        onSuccess: (target) => {
          if (controller.signal.aborted || sequence.current !== request) return

          if (kind === 'random' && target === null) {
            dispatch(ReaderEvent.Notice({ request, message: 'No other unread tweets remaining.' }))
          } else {
            go(target)
          }
        },
        onFailure: () => {
          if (!controller.signal.aborted)
            dispatch(
              ReaderEvent.Notice({
                request,
                message: "Couldn't update reading options. Try again.",
              }),
            )
        },
      }),
      Effect.ensuring(
        Effect.sync(() => {
          if (action.current === controller) {
            action.current = null
            dispatch(ReaderEvent.Action({ request, busy: false }))
          }
        }),
      ),
    )

    const pending = Effect.runPromise(work, { signal: controller.signal })
    pending.catch(() => {
      if (!controller.signal.aborted)
        dispatch(
          ReaderEvent.Notice({ request, message: "Couldn't update reading options. Try again." }),
        )
    })
  }

  return {
    ...state,
    go,
    retry: () => go(target.slug),
    random: () => runAction('random'),
    reset: () => runAction('reset'),
  }
}
