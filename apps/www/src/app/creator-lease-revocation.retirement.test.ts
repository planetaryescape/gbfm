import { Router } from '@effect/ui'
import { TestHost } from '@effect/ui/testing'
import { Effect, Predicate } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  beginSave,
  completeSave,
  creatorModel,
  creatorPath,
  expectWritingAbsent,
  makeCreatorLeaseFixture,
  mountWriting,
  openCreatorChooser,
  runCreatorLease,
} from './creator-lease.retirement.test-support'
import { RoutedApplicationMessage } from './routed-application'
import { fieldValue, input, submitCreator } from './routed-feature-lifetime.test-support'
import { pumpReaderUntil } from './routed-reader-lifetime.test-support'

const cases = ['/new', '/new/editorial', '/new/mix', '/new/tweet'].flatMap((path) =>
  ['account-b', 'unknown-principal', 'different-query', 'authentication'].flatMap((mode) =>
    ['success', 'failure'].map((outcome) => ({ path, mode, outcome })),
  ),
)

describe('Root Creator verification lease revocation', () => {
  it.each(cases)(
    '$path revokes on $mode before late save $outcome can affect a replacement',
    async ({ path, mode, outcome }) => {
      const fixture = makeCreatorLeaseFixture(path)
      await runCreatorLease(
        fixture,
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* mountWriting(fixture)
          const oldPath = creatorPath(root)
          yield* beginSave(root, fixture)
          const verification = fixture.hold()
          root.send(RoutedApplicationMessage.ClickedRetryPage())
          yield* pumpReaderUntil(() => verification.started())
          expectWritingAbsent(root)
          const oldLease = root.model()?.creatorLease

          if (!oldLease) throw new Error('Expected active verification lease')
          let replacementOwner = 'owner-b'

          if (mode === 'account-b') {
            fixture.account('owner-b')
            verification.respond(Response.json(fixture.document(path, 'owner-b')))
            yield* TestHost.settle
          } else if (mode === 'unknown-principal') {
            verification.respond(Response.json(fixture.document(path, 'owner-a', false)))
            yield* TestHost.settle
            expectWritingAbsent(root)
            expect(root.model()?.creatorLease).toBeNull()
            expect(fixture.saves[0]?.aborted()).toBe(true)
            fixture.account('owner-b')
            root.send(RoutedApplicationMessage.ChangedAuthentication())
            yield* TestHost.settle
          } else {
            const location = mode === 'different-query' ? `${path}?replacement=1` : path
            const next = fixture.hold(location)

            if (mode === 'different-query') {
              replacementOwner = 'owner-a'
              yield* router.navigate(location)
            } else {
              fixture.account('owner-b')
              root.send(RoutedApplicationMessage.ChangedAuthentication())
            }

            yield* pumpReaderUntil(() => next.started())
            expectWritingAbsent(root)
            expect(fixture.saves[0]?.aborted()).toBe(true)
            verification.respond(Response.json(fixture.document(path, 'owner-a')))
            yield* TestHost.settle
            expectWritingAbsent(root)
            next.respond(Response.json(fixture.document(location, replacementOwner)))
            yield* TestHost.settle
          }

          expect(fixture.saves[0]?.aborted()).toBe(true)
          yield* openCreatorChooser(root, path)
          expect(fieldValue(root, 'title')).toBe('')
          input(root, 'title', 'Replacement private writing')

          if (path === '/new/mix')
            input(root, 'audioUrl', 'https://cdn.fixture.test/replacement.mp3')
          yield* TestHost.settle
          submitCreator(root)
          yield* pumpReaderUntil(() => fixture.saves[1]?.started())
          const replacement = creatorModel(root, replacementOwner)
          expect(replacement.saving).toBe(true)
          const reads = fixture.requests.length
          completeSave(fixture, outcome)
          yield* Effect.promise(() => fixture.saves[0]?.delivered ?? Promise.resolve())
          yield* TestHost.settle
          root.send(RoutedApplicationMessage.RequestedCreatorRefresh({ lease: oldLease }))
          yield* TestHost.settle
          expect(fixture.requests).toHaveLength(reads)
          expect(fieldValue(root, 'title')).toBe('Replacement private writing')
          expect(creatorModel(root, replacementOwner)).toEqual(replacement)
          expect(fixture.writes).toHaveLength(2)
          const freshPath = creatorPath(root, replacementOwner)

          const ended = root
            .log()
            .findIndex((entry) => Predicate.isTagged(entry, 'Unmounted') && entry.path === oldPath)

          const mounted = root
            .log()
            .findIndex((entry) => Predicate.isTagged(entry, 'Mounted') && entry.path === freshPath)

          expect(ended).toBeGreaterThanOrEqual(0)
          expect(mounted).toBeGreaterThan(ended)
          completeSave(fixture, 'failure', 1)
          yield* TestHost.settle
        }),
      )
    },
  )
})
