import { Effect } from 'effect'
import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, test } from 'vitest'

import { receiptStorageFixture } from '@/test/composerReceiptStorage'

import { ComposerReceiptStorage } from './composerReceipts'
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
  let view: ReactTestRenderer | undefined

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

  await act(() => {
    view = create(createElement(Harness, { principal: 'first' }))
  })

  if (!current || !view) throw new Error('Session not mounted')
  const first = current
  const mounted = view
  const pending: Array<Promise<unknown>> = []
  await act(() => {
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
  await act(() => mounted.update(createElement(Harness, { principal: 'second' })))
  expect(requests[0]?.signal.aborted).toBe(true)
  expect(current.owner.state('second/reply/thread')).toHaveProperty('_tag', 'Writable')
  expect(first.available()).toBe(false)
  requests[0]?.finish({ slug: 'accepted-remotely' })
  await Promise.all(pending)
  expect(accepted).toEqual([])
  await act(() => mounted.update(createElement(Harness, { principal: 'first' })))
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
  await act(() => mounted.unmount())
  expect(restored.run(Effect.succeed('stale'), () => accepted.push('stale'))).toBeNull()
  expect(accepted).toEqual([])
})
