import { Effect, Fiber, ManagedRuntime, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, test } from 'vitest'

import { receiptStorageFixture } from '@/test/composerReceiptStorage'

import { composerControls, createComposerOwner } from './composerOwner'
import { ComposerReceiptStorage } from './composerReceipts'
import { ComposerSubmission } from './composerSubmission'
import { emptyTweetDraft, type TweetDraft } from './draft'
import { TweetDraftStorage } from './draftRestore'

const key = 'account/reply/thread'

const draft = { ...emptyTweetDraft('fixed'), text: 'Published text' }

class LocalStorageFailed extends Schema.TaggedError<LocalStorageFailed>()('LocalStorageFailed', {
  message: Schema.String,
}) {}

const fixture = () => {
  const owner = createComposerOwner('account')
  const receipts = receiptStorageFixture().storage
  const drafts = new Map<string, TweetDraft>([[key, draft]])
  const failures = new Set(['remove'])
  const requests: Array<string> = []
  const writes: Array<TweetDraft> = []

  const storage = TweetDraftStorage.of({
    read: (identity) => Effect.sync(() => drafts.get(identity) ?? null),
    save: (identity, value) =>
      Effect.suspend(() => {
        if (failures.has('save'))
          return Effect.fail(new LocalStorageFailed({ message: 'Full device' }))
        drafts.set(identity, value)
        writes.push(value)

        return Effect.void
      }),
    remove: (identity) =>
      Effect.suspend(() => {
        if (failures.has('remove'))
          return Effect.fail(new LocalStorageFailed({ message: 'Cannot clear' }))
        drafts.delete(identity)

        return Effect.void
      }),
  })

  const request = Effect.sync(() => {
    requests.push('reply')

    return { slug: `reply-${requests.length}` }
  })

  const submit = (publish = true, current = draft) =>
    Effect.runPromise(
      owner
        .submit(key, current, publish, true, request)
        .pipe(
          Effect.provideService(TweetDraftStorage, storage),
          Effect.provideService(ComposerReceiptStorage, receipts),
        ),
    )

  const change = (next: TweetDraft) =>
    owner.change(key, () => Effect.runSync(storage.save(key, next).pipe(Effect.as(true))))

  return { owner, drafts, failures, requests, writes, submit, change, storage, receipts }
}

test('published cleanup blocks edits without changing memory or device storage', async () => {
  const composer = fixture()
  await composer.submit()
  const publication = composer.owner.state(key)
  expect(composer.change({ ...draft, text: 'Unpublished edit' })).toBe(false)
  expect(composer.owner.state(key)).toBe(publication)
  expect(composer.writes).toEqual([])
  expect(composer.drafts.get(key)).toEqual(draft)
})

test('published cleanup cannot save the published copy as an unpublished draft', async () => {
  const composer = fixture()
  await composer.submit()
  expect(await composer.submit(false)).toBeNull()
  expect(composer.requests).toEqual(['reply'])
  expect(composer.writes).toEqual([])
  expect(composer.drafts.get(key)).toEqual(draft)
})

test.each(['Post', 'Reply', 'Save'])(
  'cleanup has its own enabled action instead of %s despite failed fresh-submit checks',
  async (label) => {
    const composer = fixture()
    await composer.submit()
    expect(
      composerControls(composer.owner.state(key), { canSubmit: false, canSave: true, label }),
    ).toEqual({
      editable: false,
      cleanupPending: true,
      requiresThreadCheck: false,
      canSubmit: true,
      canSave: false,
      label: 'Retry cleanup',
      busyLabel: 'Clearing',
    })
  },
)

test('cleanup keeps the publication snapshot and needs neither another request nor a draft write', async () => {
  const composer = fixture()
  const first = await composer.submit()
  composer.failures.add('save')
  const changed = { ...draft, text: 'Invalid late edit' }
  expect(await composer.submit(true, changed)).toEqual(first)
  expect(composer.drafts.get(key)).toEqual(draft)
  composer.failures.delete('remove')
  expect(await composer.submit()).toEqual(ComposerSubmission.Published({ slug: 'reply-1' }))
  expect(composer.requests).toEqual(['reply'])
  expect(composer.writes).toEqual([])
  expect(composer.drafts.has(key)).toBe(false)
  expect(composer.owner.change(key, () => true)).toBe(false)
  expect(await composer.submit()).toBeNull()
})

test('publication receipts restore only for the same account and storage key', async () => {
  const composer = fixture()
  await composer.submit()
  const fresh = { canSubmit: true, canSave: true, label: 'Reply' }
  expect(composerControls(composer.owner.state('other-account/reply/thread'), fresh).editable).toBe(
    true,
  )
  const restored = createComposerOwner('account')
  await Effect.runPromise(
    restored.restore(key).pipe(Effect.provideService(ComposerReceiptStorage, composer.receipts)),
  )
  expect(composerControls(restored.state(key), fresh).cleanupPending).toBe(true)
})

test('fresh drafts remain editable and keep their normal submission controls', () => {
  const composer = fixture()
  const next = { ...draft, text: 'Fresh edit' }
  expect(composer.change(next)).toBe(true)
  expect(composer.drafts.get(key)).toEqual(next)
  expect(composer.writes).toEqual([next])
  expect(
    composerControls(composer.owner.state(key), {
      canSubmit: false,
      canSave: true,
      label: 'Reply',
    }),
  ).toEqual({
    editable: true,
    cleanupPending: false,
    requiresThreadCheck: false,
    canSubmit: false,
    canSave: true,
    label: 'Reply',
    busyLabel: 'Saving',
  })
})

test('an accepted reply with a lost response cannot be published again before checking the thread', async () => {
  const composer = fixture()
  const runtime = ManagedRuntime.make(TestClock.layer())

  const request = Effect.sync(() => composer.requests.push('accepted reply')).pipe(
    Effect.andThen(Effect.never),
  )

  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const first = yield* composer.owner
          .submit(key, draft, true, true, request)
          .pipe(Effect.forkScoped)

        yield* TestClock.adjust('30 seconds')
        const outcome = yield* Fiber.join(first)

        const retry = yield* composer.owner
          .submit(key, draft, true, true, request)
          .pipe(Effect.forkScoped)

        yield* TestClock.adjust('30 seconds')
        const retried = yield* Fiber.join(retry)
        expect(composer.requests).toEqual(['accepted reply'])
        expect(retried).toBeNull()
        expect(outcome && ComposerSubmission.$is('PublicationOutcomeUncertain')(outcome)).toBe(true)
        expect(composer.change({ ...draft, text: 'Another reply' })).toBe(false)
        expect(yield* composer.owner.submit(key, draft, false, true, request)).toBeNull()
        expect(composer.drafts.get(key)).toEqual(draft)
        expect(composer.writes).toEqual([])
        expect(
          composerControls(composer.owner.state(key), {
            canSubmit: false,
            canSave: true,
            label: 'Reply',
          }),
        ).toMatchObject({
          editable: false,
          canSubmit: true,
          canSave: false,
          requiresThreadCheck: true,
          label: 'Check thread',
        })
      }).pipe(
        Effect.provideService(TweetDraftStorage, composer.storage),
        Effect.provideService(ComposerReceiptStorage, composer.receipts),
        Effect.scoped,
      ),
    )
  } finally {
    await runtime.dispose()
  }
})
