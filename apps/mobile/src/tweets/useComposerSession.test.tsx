import { Effect } from 'effect'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'test-renderer'
import { expect, test } from 'vitest'

import { TweetAuthoringFailed } from '@/api/tweetAuthoring'
import { receiptStorageFixture } from '@/test/composerReceiptStorage'

import { ComposerReceiptStorage } from './composerReceipts'
import { requestComposerRecovery } from './composerRecovery'
import { emptyTweetDraft } from './draft'
import { TweetDraftStorage } from './draftRestore'
import { useComposerSession } from './useComposerSession'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test('the owning session gates same-render submission, aborts on account replacement and restores durable uncertainty', async () => {
  const receipts = receiptStorageFixture().storage
  const draft = { ...emptyTweetDraft('fixture'), text: 'Reply text' }

  const drafts = TweetDraftStorage.of({
    read: () => Effect.succeed(draft),
    save: () => Effect.void,
    remove: Effect.fn(() => Effect.die('An uncertain reply cannot be cleared')),
  })

  let current: ReturnType<typeof useComposerSession> | undefined

  const requests: Array<{
    readonly signal: AbortSignal
    readonly finish: (result: { readonly slug: string }) => void
  }> = []

  const accepted: Array<string> = []

  function Harness({ principal }: { readonly principal: string }) {
    const session = useComposerSession(principal, `${principal}/reply/thread`)
    useEffect(() => {
      current = session
    })

    return null
  }

  const request = Effect.promise(
    (signal) =>
      new Promise<{ readonly slug: string }>((finish) => {
        requests.push({ signal, finish })
      }),
  )

  const provide = <A, E>(work: Effect.Effect<A, E, ComposerReceiptStorage | TweetDraftStorage>) =>
    work.pipe(
      Effect.provideService(ComposerReceiptStorage, receipts),
      Effect.provideService(TweetDraftStorage, drafts),
    )

  const mounted = createRoot()
  await act(async () => {
    mounted.render(createElement(Harness, { principal: 'first' }))
  })

  if (!current) throw new Error('Session not mounted')
  const first = current
  const pending: Array<Promise<unknown>> = []
  await act(async () => {
    const started = first.run(
      provide(first.owner.submit('first/reply/thread', draft, true, true, request)),
      () => accepted.push('first'),
    )

    if (started) pending.push(started)
    expect(
      first.run(provide(first.owner.submit('first/reply/thread', draft, true, true, request)), () =>
        accepted.push('duplicate'),
      ),
    ).toBeNull()
  })
  expect(requests).toHaveLength(1)
  expect(current.busy).toBe(true)
  await act(async () => mounted.render(createElement(Harness, { principal: 'second' })))
  expect(requests[0]?.signal.aborted).toBe(true)
  expect(current.owner.state('second/reply/thread')).toHaveProperty('_tag', 'Writable')
  expect(first.available()).toBe(false)
  requests[0]?.finish({ slug: 'accepted-remotely' })
  await Promise.all(pending)
  expect(accepted).toEqual([])
  await act(async () => mounted.render(createElement(Harness, { principal: 'first' })))
  const restored = current
  await act(async () => {
    await restored.run(provide(restored.owner.restore('first/reply/thread')), () => undefined)
  })
  expect(restored.owner.state('first/reply/thread')).toHaveProperty('_tag', 'PublicationUncertain')
  expect(restored.owner.state('first/reply/thread')).toMatchObject({ draft })
  await act(async () => {
    await restored.run(
      provide(restored.owner.submit('first/reply/thread', draft, true, true, request)),
      () => undefined,
    )
  })
  expect(requests).toHaveLength(1)
  const confirmations: Array<() => void> = []
  const recoveries: Array<Promise<unknown>> = []
  requestComposerRecovery(
    restored.owner.state('first/reply/thread'),
    (_prompt, confirm) => confirmations.push(confirm),
    () => {
      const work = restored.run(
        provide(restored.owner.recover('first/reply/thread')),
        () => undefined,
      )

      if (work) recoveries.push(work)
    },
  )
  expect(recoveries).toHaveLength(0)
  expect(restored.owner.state('first/reply/thread')).toHaveProperty('_tag', 'PublicationUncertain')
  await act(async () => {
    confirmations[0]?.()
    await Promise.all(recoveries)
  })
  expect(restored.owner.state('first/reply/thread')).toHaveProperty('_tag', 'Writable')
  expect(requests).toHaveLength(1)
  await act(async () => mounted.unmount())
  expect(restored.run(Effect.succeed('stale'), () => accepted.push('stale'))).toBeNull()
  expect(accepted).toEqual([])
})

test('the owning hook permits a fresh explicit submission after definitive rejection clears its receipt', async () => {
  const receipts = receiptStorageFixture().storage
  const draft = { ...emptyTweetDraft('retry'), text: 'Reply text' }

  const drafts = TweetDraftStorage.of({
    read: () => Effect.succeed(draft),
    save: () => Effect.void,
    remove: () => Effect.void,
  })

  let current: ReturnType<typeof useComposerSession> | undefined

  function Harness() {
    const session = useComposerSession('account', 'account/reply/thread')
    useEffect(() => {
      current = session
    })

    return null
  }

  const mounted = createRoot()
  await act(async () => {
    mounted.render(createElement(Harness))
  })

  if (!current) throw new Error('Session not mounted')
  const session = current

  const provide = <A, E>(work: Effect.Effect<A, E, ComposerReceiptStorage | TweetDraftStorage>) =>
    work.pipe(
      Effect.provideService(ComposerReceiptStorage, receipts),
      Effect.provideService(TweetDraftStorage, drafts),
    )

  const outcomes: Array<string> = []
  await act(async () => {
    await session.run(
      provide(
        session.owner.submit(
          'account/reply/thread',
          draft,
          true,
          true,
          Effect.fail(new TweetAuthoringFailed({ message: 'Expired session' })),
        ),
      ),
      (outcome) => {
        if (outcome) outcomes.push(outcome._tag)
      },
    )
  })
  expect(outcomes).toEqual(['RequestFailed'])
  expect(session.available()).toBe(true)
  expect(
    await Effect.runPromise(
      receipts.read({ principal: 'account', storageKey: 'account/reply/thread' }),
    ),
  ).toBeNull()
  await act(async () => {
    await session.run(
      provide(
        session.owner.submit(
          'account/reply/thread',
          draft,
          true,
          true,
          Effect.succeed({ slug: 'retry-success' }),
        ),
      ),
      (outcome) => {
        if (outcome) outcomes.push(outcome._tag)
      },
    )
  })
  expect(outcomes).toEqual(['RequestFailed', 'Published'])
  await act(async () => mounted.unmount())
})
