import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { Effect, Redacted } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { useFocusEffect } from 'expo-router'
import { type Dispatch, useCallback, useReducer, useRef, useState } from 'react'

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

import { initialReaderState, readerAcceptsAction, ReaderEvent, reduceReader } from './readerState'

const checkpoints = Atom.make<Readonly<Record<string, string>>>({}).pipe(Atom.keepAlive)

const bounded = <A, E>(work: Effect.Effect<A, E>) =>
  work.pipe(
    Effect.timeoutOrElse({
      duration: '15 seconds',
      orElse: () => Effect.fail(new TweetReaderUnavailable()),
    }),
  )

const connect = (sessionToken: string | null) =>
  getHttpClient.pipe(
    Effect.map((httpClient): ReaderConnection => ({
      httpClient,
      baseUrl: env.EXPO_PUBLIC_API_URL,
      sessionToken: sessionToken ? Redacted.make(sessionToken) : null,
    })),
    Effect.mapError(() => new TweetReaderUnavailable()),
  )

const loadVisit = (input: {
  readonly sessionToken: string | null
  readonly slug: string | null
  readonly request: number
  readonly dispatch: Dispatch<ReaderEvent>
  readonly remember: (slug: string) => void
}) =>
  bounded(connect(input.sessionToken)).pipe(
    Effect.flatMap((connection) =>
      Effect.gen(function* () {
        const screen = yield* bounded(loadReaderPost(connection, input.slug))
        input.dispatch(ReaderEvent.Loaded({ request: input.request, screen }))

        if (!screen) return

        const current = screen.post.slug
        input.remember(current)
        yield* bounded(recordReaderVisit(connection, current)).pipe(
          Effect.match({
            onSuccess: () =>
              input.dispatch(ReaderEvent.Progress({ request: input.request, failed: false })),
            onFailure: () =>
              input.dispatch(ReaderEvent.Progress({ request: input.request, failed: true })),
          }),
        )
        yield* bounded(loadReaderNavigation(connection, current)).pipe(
          Effect.match({
            onSuccess: (navigation) =>
              input.dispatch(ReaderEvent.Navigation({ request: input.request, navigation })),
            onFailure: () =>
              input.dispatch(ReaderEvent.NavigationFailed({ request: input.request })),
          }),
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
    slug: initialSlug ?? saved[identity] ?? null,
    revision: 0,
  })

  const [state, dispatch] = useReducer(reduceReader, initialReaderState)
  const sequence = useRef(0)
  const focused = useRef(false)
  const action = useRef<AbortController | null>(null)

  useFocusEffect(
    useCallback(() => {
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
        dispatch,
        remember: (current) => remember((positions) => ({ ...positions, [identity]: current })),
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
    }, [identity, sessionToken, target, remember]),
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

    const work = connect(sessionToken).pipe(
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
