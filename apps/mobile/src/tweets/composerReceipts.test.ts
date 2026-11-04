import { mkdtempSync, readFileSync, existsSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Deferred, Effect, Fiber, Predicate, Schema } from 'effect'
import { afterEach, expect, test } from 'vitest'

import { createComposerOwner } from './composerOwner'
import {
  ComposerReceiptStorage,
  composerReceiptKey,
  receiptStorageFromLocal,
  PendingPublication,
} from './composerReceipts'
import { ComposerSubmission } from './composerSubmission'
import { emptyTweetDraft, normalizeStoredDraft, StoredTweetDraft } from './draft'
import { TweetDraftStorage } from './draftRestore'

const directories: Array<string> = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

const scope = { principal: 'account', storageKey: 'account/reply/thread' }

const draft = { ...emptyTweetDraft('fixture'), text: 'A saved reply' }

const decodeDraft = Schema.decodeUnknownSync(Schema.fromJsonString(StoredTweetDraft))

class StorageFailed extends Schema.TaggedError<StorageFailed>()('LocalStorageFailed', {
  message: Schema.String,
}) {}

const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'gbfm-composer-receipts-'))
  directories.push(directory)
  const failures = new Set<string>()

  const raw = {
    read: (key: string) =>
      Effect.try({
        try: () =>
          existsSync(join(directory, key)) ? readFileSync(join(directory, key), 'utf8') : null,
        catch: () => new StorageFailed({ message: 'Read failed' }),
      }),
    write: (key: string, value: string) =>
      Effect.try({
        try: () => {
          if (
            failures.has('write') ||
            (failures.has('confirm') && Predicate.isTagged(JSON.parse(value), 'Confirmed'))
          )
            throw new Error('Write failed')
          writeFileSync(join(directory, key), value)
        },
        catch: () => new StorageFailed({ message: 'Write failed' }),
      }),
    remove: (key: string) =>
      Effect.try({
        try: () => {
          if (failures.has('receipt-remove') && key.startsWith('gbfm-tweet-publication-'))
            throw new Error('Remove failed')

          if (existsSync(join(directory, key))) unlinkSync(join(directory, key))
        },
        catch: () => new StorageFailed({ message: 'Remove failed' }),
      }),
  }

  const draftFile = (key: string) => `draft-${encodeURIComponent(key)}.json`

  const storage = TweetDraftStorage.of({
    read: (key) =>
      raw
        .read(draftFile(key))
        .pipe(
          Effect.map((value) => (value === null ? null : normalizeStoredDraft(decodeDraft(value)))),
        ),
    save: (key, value) => raw.write(draftFile(key), JSON.stringify(value)),
    remove: (key) =>
      Effect.suspend(() =>
        failures.has('draft-remove')
          ? Effect.fail(new StorageFailed({ message: 'Cleanup failed' }))
          : raw.remove(draftFile(key)),
      ),
  })

  Effect.runSync(storage.save(scope.storageKey, draft))
  const receipts = () => receiptStorageFromLocal(raw)

  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(TweetDraftStorage, storage),
      Effect.provideService(ComposerReceiptStorage, receipts()),
    )

  const run = <A, E>(effect: Effect.Effect<A, E, TweetDraftStorage | ComposerReceiptStorage>) =>
    Effect.runPromise(provide(effect))

  return { raw, storage, receipts, failures, run, provide, draftFile }
}

test('writes pending intent before dispatch; a recreated owner blocks a lost reply response', async () => {
  const f = fixture()
  const owner = createComposerOwner(scope.principal)
  const entered = Deferred.makeUnsafe<void>()
  let requests = 0

  const request = Effect.gen(function* () {
    requests += 1
    expect((yield* f.receipts().read(scope))?._tag).toBe('Pending')
    yield* Deferred.succeed(entered, undefined)

    return yield* Effect.never
  })

  await f.run(
    Effect.gen(function* () {
      const first = yield* owner
        .submit(scope.storageKey, draft, true, true, request)
        .pipe(Effect.forkScoped)

      yield* Deferred.await(entered)
      expect(yield* owner.submit(scope.storageKey, draft, true, true, request)).toBeNull()
      yield* Fiber.interrupt(first)
    }).pipe(Effect.scoped),
  )
  const restored = createComposerOwner(scope.principal)
  expect(await f.run(restored.restore(scope.storageKey))).toHaveProperty(
    '_tag',
    'PublicationUncertain',
  )
  expect(restored.state(scope.storageKey)).toMatchObject({ draft })
  expect(await f.run(restored.submit(scope.storageKey, draft, true, true, request))).toBeNull()
  expect(restored.change(scope.storageKey, () => true)).toBe(false)
  expect(requests).toBe(1)
  expect(await f.run(f.storage.read(scope.storageKey))).toEqual(draft)
})

test('intent write failure does not dispatch or destroy the saved draft', async () => {
  const f = fixture()
  f.failures.add('write')
  let requests = 0

  const result = await f.run(
    createComposerOwner(scope.principal).submit(
      scope.storageKey,
      draft,
      true,
      true,
      Effect.sync(() => ({ slug: `reply-${++requests}` })),
    ),
  )

  expect(result).toMatchObject({
    message: expect.stringContaining('Nothing was sent'),
  })
  expect(requests).toBe(0)
  expect(await f.run(f.storage.read(scope.storageKey))).toEqual(draft)
})

test('confirmed receipt survives cleanup failure and a recreated owner cleans up without remote repetition', async () => {
  const f = fixture()
  f.failures.add('draft-remove')
  let requests = 0
  const request = Effect.sync(() => ({ slug: `reply-${++requests}` }))

  const first = await f.run(
    createComposerOwner(scope.principal).submit(scope.storageKey, draft, true, true, request),
  )

  expect(first?._tag).toBe('PublishedNotCleared')
  expect(await f.run(f.receipts().read(scope))).toMatchObject({
    slug: 'reply-1',
    draft,
  })
  const next = createComposerOwner(scope.principal)
  expect(await f.run(next.restore(scope.storageKey))).toMatchObject({
    slug: 'reply-1',
  })
  f.failures.clear()
  expect(await f.run(next.submit(scope.storageKey, draft, true, true, request))).toEqual(
    ComposerSubmission.Published({ slug: 'reply-1' }),
  )
  expect(requests).toBe(1)
  expect(await f.run(f.storage.read(scope.storageKey))).toBeNull()
  expect(await f.run(f.receipts().read(scope))).toBeNull()
})

test('failed confirmation persistence leaves pending intent, preserves the draft and blocks a fresh owner', async () => {
  const f = fixture()
  f.failures.add('confirm')
  const request = Effect.succeed({ slug: 'accepted-reply' })
  const owner = createComposerOwner(scope.principal)
  expect(await f.run(owner.submit(scope.storageKey, draft, true, true, request))).toHaveProperty(
    '_tag',
    'PublishedNotCleared',
  )
  expect((await f.run(f.receipts().read(scope)))?._tag).toBe('Pending')
  expect(await f.run(f.storage.read(scope.storageKey))).toEqual(draft)
  expect(
    await f.run(createComposerOwner(scope.principal).restore(scope.storageKey)),
  ).toHaveProperty('_tag', 'PublicationUncertain')
  f.failures.clear()
  expect(
    await f.run(owner.submit(scope.storageKey, draft, true, true, Effect.die('Must not resend'))),
  ).toEqual(ComposerSubmission.Published({ slug: 'accepted-reply' }))
})

test('a crash window after draft deletion retains confirmation until receipt cleanup succeeds', async () => {
  const f = fixture()
  f.failures.add('receipt-remove')
  await f.run(
    createComposerOwner(scope.principal).submit(
      scope.storageKey,
      draft,
      true,
      true,
      Effect.succeed({ slug: 'reply' }),
    ),
  )
  expect(await f.run(f.storage.read(scope.storageKey))).toBeNull()
  const restored = createComposerOwner(scope.principal)
  expect(await f.run(restored.restore(scope.storageKey))).toMatchObject({
    slug: 'reply',
  })
  f.failures.clear()
  expect(
    await f.run(
      restored.submit(scope.storageKey, draft, true, true, Effect.die('Must not resend')),
    ),
  ).toHaveProperty('_tag', 'Published')
})

test('cleanup preserves a newer local draft even if its slug matches the published snapshot', async () => {
  const f = fixture()
  f.failures.add('draft-remove')
  await f.run(
    createComposerOwner(scope.principal).submit(
      scope.storageKey,
      draft,
      true,
      true,
      Effect.succeed({ slug: 'reply' }),
    ),
  )
  const newer = { ...draft, text: 'Newer unsent text' }
  await f.run(f.storage.save(scope.storageKey, newer))
  f.failures.clear()
  const owner = createComposerOwner(scope.principal)
  await f.run(owner.restore(scope.storageKey))
  await f.run(owner.submit(scope.storageKey, draft, true, true, Effect.die('Must not resend')))
  expect(await f.run(f.storage.read(scope.storageKey))).toEqual(newer)
})

test.each(['corrupt', 'foreign'])(
  'unreadable %s recovery data fails closed without exposing or overwriting a draft',
  async (kind) => {
    const f = fixture()

    const raw =
      kind === 'corrupt'
        ? '{broken'
        : JSON.stringify(
            PendingPublication.make({
              ...scope,
              principal: 'another-account',
              version: 1,
              draft: { ...draft, text: 'Private foreign text' },
              replying: true,
            }),
          )

    await Effect.runPromise(f.raw.write(composerReceiptKey(scope), raw))
    const owner = createComposerOwner(scope.principal)
    expect(await f.run(owner.restore(scope.storageKey).pipe(Effect.isFailure))).toBe(true)
    expect(owner.state(scope.storageKey)).toHaveProperty('_tag', 'RecoveryBlocked')
    expect(JSON.stringify(owner.state(scope.storageKey))).not.toContain('Private foreign text')
    expect(
      await f.run(owner.submit(scope.storageKey, draft, true, true, Effect.die('Must not send'))),
    ).toBeNull()
    expect(await f.run(f.storage.read(scope.storageKey))).toEqual(draft)
    expect(await Effect.runPromise(f.raw.read(composerReceiptKey(scope)))).toBe(raw)
  },
)

test('accounts use distinct keys and legacy drafts are untouched when no receipt exists', async () => {
  const f = fixture()
  await Effect.runPromise(
    f.raw.write(
      f.draftFile('account'),
      JSON.stringify({
        slug: 'legacy',
        title: 'Old title',
        content: 'Saved body',
        tags: 'music',
        remote: false,
        music: null,
      }),
    ),
  )
  const before = await Effect.runPromise(f.raw.read(f.draftFile('account')))
  expect(await f.run(createComposerOwner('account').restore('account'))).toHaveProperty(
    '_tag',
    'Writable',
  )
  expect(await Effect.runPromise(f.raw.read(f.draftFile('account')))).toBe(before)
  await f.run(
    f.receipts().write(PendingPublication.make({ ...scope, version: 1, draft, replying: true })),
  )
  const foreign = { principal: 'other', storageKey: 'other/reply/thread' }
  expect(await f.run(f.receipts().read(foreign))).toBeNull()
  expect(
    await f.run(
      f
        .receipts()
        .read({ principal: 'other', storageKey: scope.storageKey })
        .pipe(Effect.isFailure),
    ),
  ).toBe(true)
})
