import { Deferred, Effect, Exit, Fiber, ManagedRuntime, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, test } from 'vitest'

import { TweetAuthoringFailed } from '@/api/tweetAuthoring'

import { ComposerSubmission, submitComposerDraft } from './composerSubmission'
import { emptyTweetDraft, type TweetDraft } from './draft'
import { restoreDraft, TweetDraftStorage } from './draftRestore'
import { lookupMusic } from './musicLookup'

const runWithClock = async <A, E>(work: Effect.Effect<A, E, TestClock.TestClock>) => {
  const runtime = ManagedRuntime.make(TestClock.layer())

  try {
    return await runtime.runPromise(work)
  } finally {
    await runtime.dispose()
  }
}

class StorageFailed extends Schema.TaggedError<StorageFailed>()('LocalStorageFailed', {
  message: Schema.String,
}) {}

const draft = { ...emptyTweetDraft('fixed'), text: 'A record' }

const music = {
  entityType: 'album' as const,
  entityId: 'record',
  title: 'A record',
  url: 'https://music.test/record',
  coverImageUrl: null,
}

const storageFixture = (initial: ReadonlyArray<readonly [string, TweetDraft]> = []) => {
  const drafts = new Map(initial)
  const failures = new Set<string>()

  const store = TweetDraftStorage.of({
    read: (key) =>
      failures.has('read')
        ? Effect.fail(new StorageFailed({ message: 'Unreadable draft' }))
        : Effect.succeed(drafts.get(key) ?? null),
    save: (key, value) =>
      failures.has('save')
        ? Effect.fail(new StorageFailed({ message: 'Full device' }))
        : Effect.sync(() => {
            drafts.set(key, value)
          }),
    remove: (key) =>
      failures.has('remove')
        ? Effect.fail(new StorageFailed({ message: 'Cannot remove' }))
        : Effect.sync(() => {
            drafts.delete(key)
          }),
  })

  return { drafts, failures, store }
}

test('restores existing drafts and adopts guest text without replacing the account slug', async () => {
  const storage = storageFixture([
    ['account', draft],
    ['guest', { ...draft, text: 'Shared link' }],
  ])

  const restored = await Effect.runPromise(
    restoreDraft('account').pipe(Effect.provideService(TweetDraftStorage, storage.store)),
  )

  expect(restored).toEqual({ ...draft, text: 'A record\n\nShared link' })
  expect(storage.drafts.get('account')).toEqual(restored)
  expect(storage.drafts.has('guest')).toBe(false)
})

test('absent drafts remain absent and guest restore does not migrate storage', async () => {
  const storage = storageFixture([['guest', draft]])
  expect(
    await Effect.runPromise(
      restoreDraft('guest').pipe(Effect.provideService(TweetDraftStorage, storage.store)),
    ),
  ).toEqual(draft)
  expect(storage.drafts.get('guest')).toEqual(draft)
  storage.drafts.clear()
  expect(
    await Effect.runPromise(
      restoreDraft('account').pipe(Effect.provideService(TweetDraftStorage, storage.store)),
    ),
  ).toBeNull()
})

test('failed guest adoption write retains both drafts', async () => {
  const storage = storageFixture([
    ['account', draft],
    ['guest', draft],
  ])

  storage.failures.add('save')
  expect(
    await Effect.runPromise(
      restoreDraft('account').pipe(
        Effect.provideService(TweetDraftStorage, storage.store),
        Effect.isFailure,
      ),
    ),
  ).toBe(true)
  expect([...storage.drafts.values()]).toEqual([draft, draft])
})

test('characterizes guest cleanup failure: retry appends the guest text a second time', async () => {
  const guest = { ...draft, text: 'Guest text' }

  const storage = storageFixture([
    ['account', draft],
    ['guest', guest],
  ])

  storage.failures.add('remove')

  const restore = restoreDraft('account').pipe(
    Effect.provideService(TweetDraftStorage, storage.store),
    Effect.isFailure,
  )

  expect(await Effect.runPromise(restore)).toBe(true)
  expect(storage.drafts.get('account')?.text).toBe('A record\n\nGuest text')
  expect(await Effect.runPromise(restore)).toBe(true)
  expect(storage.drafts.get('account')?.text).toBe('A record\n\nGuest text\n\nGuest text')
  expect(storage.drafts.get('guest')).toEqual(guest)
})

test('read failure never overwrites existing draft storage', async () => {
  const storage = storageFixture([['account', draft]])
  storage.failures.add('read')
  expect(
    await Effect.runPromise(
      restoreDraft('account').pipe(
        Effect.provideService(TweetDraftStorage, storage.store),
        Effect.isFailure,
      ),
    ),
  ).toBe(true)
  expect(storage.drafts.get('account')).toEqual(draft)
})

test('remote draft save distinguishes device write failure without losing remote success', async () => {
  const storage = storageFixture([['account', draft]])
  storage.failures.add('save')

  const outcome = await Effect.runPromise(
    submitComposerDraft('account', draft, false, false, Effect.succeed({ slug: draft.slug })).pipe(
      Effect.provideService(TweetDraftStorage, storage.store),
    ),
  )

  expect(outcome).toEqual(
    ComposerSubmission.RemoteDraftSaved({ draft: { ...draft, remote: true }, localSaved: false }),
  )
  expect(storage.drafts.get('account')?.remote).toBe(false)
})

test('remote draft success persists the same identity as an account draft', async () => {
  const storage = storageFixture([['account', draft]])

  const outcome = await Effect.runPromise(
    submitComposerDraft('account', draft, false, false, Effect.succeed({ slug: draft.slug })).pipe(
      Effect.provideService(TweetDraftStorage, storage.store),
    ),
  )

  expect(outcome).toEqual(
    ComposerSubmission.RemoteDraftSaved({ draft: { ...draft, remote: true }, localSaved: true }),
  )
  expect(storage.drafts.get('account')).toEqual({ ...draft, remote: true })
})

test('publication success is not a request failure when local cleanup fails', async () => {
  const storage = storageFixture([['account', draft]])
  storage.failures.add('remove')

  const outcome = await Effect.runPromise(
    submitComposerDraft('account', draft, true, false, Effect.succeed({ slug: draft.slug })).pipe(
      Effect.provideService(TweetDraftStorage, storage.store),
    ),
  )

  expect(outcome).toEqual(
    ComposerSubmission.PublishedNotCleared({ draft: { ...draft, remote: true } }),
  )
  expect(storage.drafts.get('account')).toEqual(draft)
})

test('successful publication clears the local draft and returns the server slug', async () => {
  const storage = storageFixture([['account', draft]])

  const outcome = await Effect.runPromise(
    submitComposerDraft('account', draft, true, false, Effect.succeed({ slug: 'saved-slug' })).pipe(
      Effect.provideService(TweetDraftStorage, storage.store),
    ),
  )

  expect(outcome).toEqual(ComposerSubmission.Published({ slug: 'saved-slug' }))
  expect(storage.drafts.has('account')).toBe(false)
})

test('failed requests preserve device storage and their user-facing failure', async () => {
  const storage = storageFixture([['account', draft]])

  const outcome = await Effect.runPromise(
    submitComposerDraft(
      'account',
      draft,
      true,
      false,
      Effect.fail(new TweetAuthoringFailed({ message: 'Denied' })),
    ).pipe(Effect.provideService(TweetDraftStorage, storage.store)),
  )

  expect(outcome).toEqual(ComposerSubmission.RequestFailed({ message: 'Denied' }))
  expect(storage.drafts.get('account')).toEqual(draft)
})

test.each([false, true])(
  'timeout keeps the draft and preserves reply-specific ambiguity (reply=%s)',
  async (replying) => {
    const storage = storageFixture([['account', draft]])
    await runWithClock(
      Effect.gen(function* () {
        const fiber = yield* submitComposerDraft(
          'account',
          draft,
          true,
          replying,
          Effect.never,
        ).pipe(Effect.forkScoped)

        yield* TestClock.adjust('30 seconds')
        const outcome = yield* Fiber.join(fiber)
        expect(ComposerSubmission.$is('RequestFailed')(outcome)).toBe(true)

        if (ComposerSubmission.$is('RequestFailed')(outcome))
          expect(outcome.message).toContain(
            replying ? 'do not reply twice' : 'without creating a second one',
          )
        expect(storage.drafts.get('account')).toEqual(draft)
      }).pipe(Effect.provideService(TweetDraftStorage, storage.store), Effect.scoped),
    )
  },
)

test('aborting a pending submission interrupts the request without clearing local data', async () => {
  const storage = storageFixture([['account', draft]])
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const request = Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))

      const fiber = yield* submitComposerDraft('account', draft, true, false, request).pipe(
        Effect.forkScoped,
      )

      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
      expect(storage.drafts.get('account')).toEqual(draft)
    }).pipe(Effect.provideService(TweetDraftStorage, storage.store), Effect.scoped),
  )
})

test('music lookup debounces and a superseded request never resolves into the draft', async () => {
  const resolved: Array<string> = []
  const loading: Array<boolean> = []
  await runWithClock(
    Effect.gen(function* () {
      const old = yield* lookupMusic(
        Effect.succeed(music),
        (value) => loading.push(value),
        (value) => resolved.push(value.entityId),
      ).pipe(Effect.forkScoped)

      yield* TestClock.adjust('699 millis')
      expect(loading).toEqual([])
      yield* Fiber.interrupt(old)

      const current = yield* lookupMusic(
        Effect.succeed({ ...music, entityId: 'new' }),
        (value) => loading.push(value),
        (value) => resolved.push(value.entityId),
      ).pipe(Effect.forkScoped)

      yield* TestClock.adjust('700 millis')
      yield* Fiber.join(current)
      expect(resolved).toEqual(['new'])
      expect(loading).toEqual([false, true, false])
    }).pipe(Effect.scoped),
  )
})

test('music lookup cancellation after request start finalizes loading without applying a result', async () => {
  const loading: Array<boolean> = []
  const resolved: Array<string> = []
  await runWithClock(
    Effect.gen(function* () {
      const fiber = yield* lookupMusic(
        Effect.never,
        (value) => loading.push(value),
        (value) => resolved.push(value.entityId),
      ).pipe(Effect.forkScoped)

      yield* TestClock.adjust('700 millis')
      expect(loading).toEqual([true])
      yield* Fiber.interrupt(fiber)
      expect(loading).toEqual([true, false])
      expect(resolved).toEqual([])
    }).pipe(Effect.scoped),
  )
})

test('music lookup timeout includes debounce and clears loading without applying a result', async () => {
  const loading: Array<boolean> = []
  const resolved: Array<string> = []
  await runWithClock(
    Effect.gen(function* () {
      const fiber = yield* lookupMusic(
        Effect.never,
        (value) => loading.push(value),
        (value) => resolved.push(value.entityId),
      ).pipe(Effect.forkScoped)

      yield* TestClock.adjust('20 seconds')
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
      expect(loading).toEqual([true, false])
      expect(resolved).toEqual([])
    }).pipe(Effect.scoped),
  )
})
