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
  privateTitle,
  runCreatorLease,
} from './creator-lease.retirement.test-support'
import { RoutedApplicationMessage } from './routed-application'
import { disabled, fieldValue } from './routed-feature-lifetime.test-support'
import { pumpReaderUntil } from './routed-reader-lifetime.test-support'

const cases = ['/new', '/new/editorial', '/new/mix', '/new/tweet'].flatMap((path) =>
  ['success', 'failure'].flatMap((outcome) =>
    ['before verification', 'after verification'].map((timing) => ({ path, outcome, timing })),
  ),
)

describe('Root Creator same-editor lease accepted work', () => {
  it.each(cases)(
    '$path save $outcome $timing preserves the editor without private DOM during verification',
    async ({ path, outcome, timing }) => {
      const fixture = makeCreatorLeaseFixture(path)
      await runCreatorLease(
        fixture,
        Effect.gen(function* () {
          const root = yield* mountWriting(fixture)
          const mountedPath = creatorPath(root)
          yield* beginSave(root, fixture)
          const leaseBefore = root.model()?.creatorLease
          const verification = fixture.hold()
          root.send(RoutedApplicationMessage.ClickedRetryPage())
          yield* pumpReaderUntil(() => verification.started())
          expectWritingAbsent(root)
          expect(fixture.saves[0]?.aborted()).toBe(false)
          const lease = root.model()?.creatorLease

          if (!lease) throw new Error('Missing active same-editor verification lease')
          expect(lease.ownerId).toBe('owner-a')
          expect(lease.editorEpoch).toBe(leaseBefore?.editorEpoch)
          expect(lease.verificationEpoch).toBeGreaterThan(lease.editorEpoch)
          const reads = fixture.requests.length
          root.send(RoutedApplicationMessage.RequestedCreatorRefresh({ lease }))
          yield* TestHost.settle
          expect(fixture.requests).toHaveLength(reads)

          if (timing === 'before verification') {
            completeSave(fixture, outcome)
            yield* pumpReaderUntil(() => !creatorModel(root).saving)
            expectWritingAbsent(root)
            expect(creatorModel(root).draft.title).toBe(privateTitle)
            expect(creatorModel(root).savedRevision > 0).toBe(outcome === 'success')
          }

          verification.respond(Response.json(fixture.document()))
          yield* TestHost.settle
          expect(fieldValue(root, 'title')).toBe(privateTitle)
          expect(root.model()?.creatorLease?.editorEpoch).toBe(lease.editorEpoch)

          if (timing === 'after verification') {
            expect(disabled(root, 'Save draft')).toBe(true)
            completeSave(fixture, outcome)
            yield* TestHost.settle
          }

          expect(creatorModel(root).saving).toBe(false)
          expect(creatorModel(root).draft.title).toBe(privateTitle)
          expect(creatorModel(root).savedRevision > 0).toBe(outcome === 'success')
          expect(fixture.writes).toHaveLength(1)
          expect(fixture.requests).toEqual([path, path])
          expect(
            root
              .log()
              .filter(
                (entry) => Predicate.isTagged(entry, 'Mounted') && entry.path === mountedPath,
              ),
          ).toHaveLength(1)
        }),
      )
    },
  )
})
