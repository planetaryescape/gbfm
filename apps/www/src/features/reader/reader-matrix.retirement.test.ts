import { Component } from '@effect/ui'
import { HtmlCommand } from '@effect/ui/html'
import { Story } from '@effect/ui/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { RecordVisit, StoreCheckpoint } from './commands'
import { destination, ReaderPageMessage } from './contracts'
import { nextUnread, UnreadTarget } from './decisions'
import { neighbours, props } from './fixtures.test-support'
import { ReaderPageNoDeps } from './page'

describe('retirement: native Reader original submatrices', () => {
  it.each(['success', 'failure'])(
    'rejects wrong-identity pending visit %s without changing ownership',
    async (outcome) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const page = {
              ...props(),
              principal: { id: 'owner', name: null, username: null, role: null },
            }

            const token = { ...destination(page), generation: 0 }
            const s = yield* Story.make(ReaderPageNoDeps, page)
            s.send(ReaderPageMessage.CommittedReader(token))
              .resolve(StoreCheckpoint, Component.noop)
              .keepPending(RecordVisit)
              .loaded('replies', [])
            const pending = s.model
            const wrong = { ...token, identity: 'anonymous' }
            s.send(
              outcome === 'success'
                ? ReaderPageMessage.SucceededRecordVisit(wrong)
                : ReaderPageMessage.FailedRecordVisit(wrong),
            )
            expect(s.model).toEqual(pending)
            expect(s.queryInfo.find((query) => query.name === 'neighbours')?.args).toBeUndefined()
            s.resolve(
              RecordVisit,
              outcome === 'success'
                ? ReaderPageMessage.SucceededRecordVisit(token)
                : ReaderPageMessage.FailedRecordVisit(token),
            )
            expect(s.model.visits.b).toBe(outcome === 'success' ? 'recorded' : 'failed')
            expect(s.queryInfo.find((query) => query.name === 'neighbours')?.args).toBeDefined()
            s.keepPending('neighbours')
          }),
        ),
      )
    },
  )

  it('earlier-first with final visible failure admits exactly one retry and retains the checkpoint', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const first = props()
          const b = { ...destination(first), generation: 0 }
          const s = yield* Story.make(ReaderPageNoDeps, first)
          s.send(ReaderPageMessage.CommittedReader(b))
            .resolve(StoreCheckpoint, Component.noop)
            .keepPending(RecordVisit)
            .loaded('replies', [])
          const second = props('a', 1)
          const a = { ...destination(second), generation: 0 }
          s.props(second)
            .send(ReaderPageMessage.ChangedDestination(destination(second)))
            .send(ReaderPageMessage.CommittedReader(a))
            .resolve(StoreCheckpoint, Component.noop)
            .resolve(HtmlCommand.Focus, { found: true })
            .loaded('replies', [])
            .resolve(RecordVisit, ReaderPageMessage.SucceededRecordVisit(b))
          expect(s.queryInfo.find((query) => query.name === 'neighbours')?.args).toBeUndefined()
          s.resolve(RecordVisit, ReaderPageMessage.FailedRecordVisit(a))
          expect(s.model.current).toBe('a')
          expect(s.model.checkpoint).toBe('a')
          expect(s.model.visits).toEqual({ b: 'recorded', a: 'failed' })
          expect(s.queryInfo.find((query) => query.name === 'neighbours')?.args).toBeDefined()
          s.keepPending('neighbours')
          s.send(ReaderPageMessage.ClickedRetryVisit())
            .expectExact(RecordVisit)
            .keepPending(RecordVisit)
          const pending = s.model
          s.send(ReaderPageMessage.ClickedRetryVisit()).expectExact(RecordVisit)
          expect(s.model).toEqual(pending)
          s.resolve(RecordVisit, ReaderPageMessage.SucceededRecordVisit(a))
          expect(s.model.visits.a).toBe('recorded')
          s.keepPending('neighbours')
        }),
      ),
    )
  })

  it('does not accept wrong-identity or obsolete navigation snapshots into the last timeline', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const page = props()
          const token = { ...destination(page), generation: 0 }
          const s = yield* Story.make(ReaderPageNoDeps, page)
          s.send(ReaderPageMessage.CommittedReader(token))
            .resolve(StoreCheckpoint, Component.noop)
            .resolve(RecordVisit, ReaderPageMessage.SucceededRecordVisit(token))
            .loaded('replies', [])
            .keepPending('neighbours')

          const valid = {
            ...token,
            revision: s.model.revision,
            refresh: s.model.refresh,
            neighbours,
          }

          const before = s.model

          for (const snapshot of [
            { ...valid, identity: 'other-account' },
            { ...valid, navigationId: token.navigationId + 1 },
            { ...valid, revision: valid.revision - 1 },
            { ...valid, refresh: valid.refresh + 1 },
          ]) {
            s.send(ReaderPageMessage.ReceivedNavigationSnapshot({ snapshot }))
            expect(s.model).toEqual(before)
          }

          s.send(ReaderPageMessage.ReceivedNavigationSnapshot({ snapshot: valid }))
          expect(s.model.lastTimeline).toEqual(neighbours.timeline)
        }),
      ),
    )
  })

  it('requires authoritative zero, not merely missing unread targets, for exhaustion', () => {
    expect(nextUnread({ ...neighbours, olderUnread: null, newerUnread: null })).toEqual(
      UnreadTarget.Unavailable(),
    )
    expect(
      nextUnread({ ...neighbours, olderUnread: null, newerUnread: null, unreadCount: 0 }),
    ).toEqual(UnreadTarget.CaughtUp())
  })
})
