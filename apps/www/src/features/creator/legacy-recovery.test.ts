import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { emptyDraft } from './domain'
import { makeLegacyRecovery } from './legacy-recovery'

const principal = { id: 'verified-guidefari-id', username: 'guidefari' }

const key = `${principal.id}:post:new`

const scopedKey = `gbfm:creator:${key}`

const legacyKey = 'gbfm:creator:post:new'

const draft = {
  ...emptyDraft('post', 'unrelated-collaborator'),
  title: 'Existing writing',
  content: 'Private original body',
}

const original = JSON.stringify(draft)

const makeStorage = () => {
  const values = new Map([[legacyKey, original]])
  const writes: Array<string> = []

  return {
    values,
    writes,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key)
      values.set(key, value)
    },
  }
}

describe('guidefari-only legacy browser draft recovery', () => {
  it.effect(
    'offers the original draft using authenticated identity, never collaborator metadata',
    () =>
      Effect.gen(function* () {
        const storage = makeStorage()
        const candidate = yield* makeLegacyRecovery(storage).read(key, principal)

        assert.deepEqual(candidate?.draft, draft)
        assert.equal(candidate?.token.ownerId, principal.id)
        assert.equal(candidate?.token.fingerprint.length, 64)
        assert.equal(storage.getItem(scopedKey), null)
        assert.equal(storage.getItem(legacyKey), original)
        assert.notInclude(storage.writes, legacyKey)
      }),
  )

  for (const action of ['restore', 'dismiss'] satisfies ReadonlyArray<'restore' | 'dismiss'>) {
    it.effect(`${action} handles this snapshot without deleting it or offering it again`, () =>
      Effect.gen(function* () {
        const storage = makeStorage()
        const recovery = makeLegacyRecovery(storage)
        const candidate = yield* recovery.read(key, principal)

        assert.isNotNull(candidate)

        if (!candidate) return
        const result = yield* recovery.resolve(key, principal, candidate.token, action)

        assert.deepEqual(result, action === 'restore' ? draft : null)
        assert.equal(storage.getItem(scopedKey), action === 'restore' ? original : null)
        storage.values.delete(scopedKey)
        assert.isNull(yield* recovery.read(key, principal))
        assert.equal(storage.getItem(legacyKey), original)
        assert.notInclude(storage.writes, legacyKey)
      }),
    )
  }

  it.effect(
    'does not read legacy content for another account, absent username or mismatched context',
    () =>
      Effect.gen(function* () {
        for (const other of [
          { id: 'account-b', username: 'other' },
          { id: principal.id, username: null },
          { id: principal.id, username: 'Guidefari' },
          { id: '', username: 'guidefari' },
          { id: 'different', username: 'guidefari' },
        ]) {
          const recovery = makeLegacyRecovery({
            getItem: () => {
              throw new Error('Unauthorized storage read')
            },
            setItem: () => {
              throw new Error('Unauthorized storage write')
            },
          })

          assert.isNull(yield* recovery.read(key, other))
        }
      }),
  )

  it.effect('pins the stable account ID and rejects a later owner of the same username', () =>
    Effect.gen(function* () {
      const storage = makeStorage()
      const recovery = makeLegacyRecovery(storage)
      yield* recovery.read(key, principal)
      const other = { id: 'username-reused-by-another-account', username: 'guidefari' }

      assert.isNull(yield* recovery.read(`${other.id}:post:new`, other))
      assert.equal(storage.getItem(legacyKey), original)
      assert.equal(storage.getItem(`gbfm:creator:${other.id}:post:new`), null)
    }),
  )

  it.effect('refuses to apply account A’s recovery token in account B’s context', () =>
    Effect.gen(function* () {
      const storage = makeStorage()
      const recovery = makeLegacyRecovery(storage)
      const candidate = yield* recovery.read(key, principal)

      assert.isNotNull(candidate)

      if (!candidate) return
      const other = { id: 'account-b', username: 'other' }

      const error = yield* recovery
        .resolve(`${other.id}:post:new`, other, candidate.token, 'restore')
        .pipe(Effect.flip)

      assert.equal(error._tag, 'CreatorStorageError')
      assert.equal(storage.getItem(legacyKey), original)
      assert.equal(storage.getItem('gbfm:creator:account-b:post:new'), null)
    }),
  )

  it.effect(
    'preserves valid or malformed existing scoped writing without offering legacy content',
    () =>
      Effect.gen(function* () {
        for (const current of [
          'malformed scoped data',
          JSON.stringify({ ...draft, title: 'Newer' }),
        ]) {
          const storage = makeStorage()
          storage.values.set(scopedKey, current)

          assert.isNull(yield* makeLegacyRecovery(storage).read(key, principal))
          assert.equal(storage.getItem(scopedKey), current)
          assert.equal(storage.getItem(legacyKey), original)
          assert.lengthOf(storage.writes, 0)
        }
      }),
  )

  it.effect('leaves malformed and wrong-context legacy snapshots untouched', () =>
    Effect.gen(function* () {
      for (const raw of ['{broken', JSON.stringify({ ...draft, kind: 'micro' })]) {
        const storage = makeStorage()
        storage.values.set(legacyKey, raw)

        assert.isNull(yield* makeLegacyRecovery(storage).read(key, principal))
        assert.equal(storage.getItem(legacyKey), raw)
        assert.equal(storage.getItem(scopedKey), null)
        assert.lengthOf(storage.writes, 0)
      }
    }),
  )

  it.effect('preserves a conflicting named edit context instead of importing it', () =>
    Effect.gen(function* () {
      const storage = makeStorage()
      const namedKey = 'gbfm:creator:post:expected-post'
      const raw = JSON.stringify({ ...draft, editSlug: 'different-post' })
      storage.values.set(namedKey, raw)

      assert.isNull(
        yield* makeLegacyRecovery(storage).read(`${principal.id}:post:expected-post`, principal),
      )
      assert.equal(storage.getItem(namedKey), raw)
      assert.lengthOf(storage.writes, 0)
    }),
  )

  it.effect('recovers legitimate post-save edits retained under the legacy new-draft key', () =>
    Effect.gen(function* () {
      const storage = makeStorage()

      const retained = {
        ...draft,
        editSlug: 'saved-post',
        postId: 'saved-post-id',
        expectedUpdatedAt: '2026-11-26T12:00:00.000Z',
        content: 'Newer writing after the original remote save',
      }

      const raw = JSON.stringify(retained)
      const destination = `gbfm:creator:${principal.id}:post:saved-post`
      storage.values.set(legacyKey, raw)
      const recovery = makeLegacyRecovery(storage)
      const candidate = yield* recovery.read(key, principal)

      assert.isNotNull(candidate)

      if (!candidate) return
      assert.deepEqual(
        yield* recovery.resolve(key, principal, candidate.token, 'restore'),
        retained,
      )
      assert.equal(storage.getItem(destination), raw)
      assert.equal(storage.getItem(scopedKey), null)
      assert.equal(storage.getItem(legacyKey), raw)
      storage.values.delete(destination)
      assert.isNull(yield* recovery.read(key, principal))
    }),
  )

  it.effect('never overwrites scoped writing at the retained post-save destination', () =>
    Effect.gen(function* () {
      const storage = makeStorage()
      const raw = JSON.stringify({ ...draft, editSlug: 'saved-post', postId: 'saved-post-id' })
      const destination = `gbfm:creator:${principal.id}:post:saved-post`
      storage.values.set(legacyKey, raw)
      storage.values.set(destination, 'Newer scoped writing')

      assert.isNull(yield* makeLegacyRecovery(storage).read(key, principal))
      assert.equal(storage.getItem(destination), 'Newer scoped writing')
      assert.equal(storage.getItem(legacyKey), raw)
      assert.lengthOf(storage.writes, 0)
    }),
  )

  it.effect(
    'rejects a legacy snapshot changed by another tab while its fingerprint is computed',
    () =>
      Effect.gen(function* () {
        const storage = makeStorage()
        const replacement = JSON.stringify({ ...draft, title: 'Other tab writing' })
        let reads = 0

        const recovery = makeLegacyRecovery({
          ...storage,
          getItem: (key) => {
            if (key === legacyKey && ++reads === 2) storage.values.set(key, replacement)

            return storage.getItem(key)
          },
        })

        assert.isNull(yield* recovery.read(key, principal))
        assert.equal(storage.getItem(legacyKey), replacement)
        assert.equal(storage.getItem(scopedKey), null)
        assert.lengthOf(storage.writes, 0)
      }),
  )

  it.effect(
    'does not overwrite scoped writing created by another tab after the prompt opened',
    () =>
      Effect.gen(function* () {
        const storage = makeStorage()
        const recovery = makeLegacyRecovery(storage)
        const candidate = yield* recovery.read(key, principal)

        assert.isNotNull(candidate)

        if (!candidate) return
        storage.values.set(scopedKey, 'Other tab scoped writing')
        yield* recovery.resolve(key, principal, candidate.token, 'restore').pipe(Effect.flip)
        assert.equal(storage.getItem(scopedKey), 'Other tab scoped writing')
        assert.equal(storage.getItem(legacyKey), original)
      }),
  )

  it.effect(
    'does not restore stale legacy content after another tab changes the original bytes',
    () =>
      Effect.gen(function* () {
        const storage = makeStorage()
        const recovery = makeLegacyRecovery(storage)
        const candidate = yield* recovery.read(key, principal)

        assert.isNotNull(candidate)

        if (!candidate) return
        storage.values.set(legacyKey, 'Malformed replacement kept for manual export')
        yield* recovery.resolve(key, principal, candidate.token, 'restore').pipe(Effect.flip)
        assert.equal(storage.getItem(legacyKey), 'Malformed replacement kept for manual export')
        assert.equal(storage.getItem(scopedKey), null)
      }),
  )
})
