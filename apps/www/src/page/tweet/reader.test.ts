import { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  init,
  Message,
  nextUnread,
  parseCheckpoint,
  UnreadTarget,
  update,
  visit,
  visitState,
  VisitState,
} from './reader'

const neighbours = Schema.decodeUnknownSync(MicroPostNeighboursResponse)({
  newer: 'c',
  older: 'a',
  olderUnread: 'a',
  newerUnread: 'c',
  seen: false,
  unreadCount: 2,
  timeline: [{ month: '2024-04', total: 3, unread: 3, newestSlug: 'c' }],
})

describe('Tweet reader', () => {
  it('waits for every pending visit before refreshing metadata for the visible destination', () => {
    const first = visit(init('anonymous'), 'b', 1, neighbours, null).model
    expect(visitState(first, 'b')).toEqual(VisitState.cases.Pending.make({}))
    expect(visitState(first, 'unknown')).toEqual(VisitState.cases.Unrecorded.make({}))
    const next = visit(first, 'a', 2, null, null).model
    expect(visitState(next, 'b')).toEqual(VisitState.cases.Pending.make({}))
    expect(visitState(next, 'a')).toEqual(VisitState.cases.Pending.make({}))
    const settledFirst = update(next, Message.Seen({ slug: 'b', identity: 'anonymous' }))
    expect(settledFirst.commands ?? []).toHaveLength(0)
    expect(visitState(settledFirst.model, 'b')).toEqual(VisitState.cases.Recorded.make({}))
    expect(visitState(settledFirst.model, 'a')).toEqual(VisitState.cases.Pending.make({}))

    const settledLast = update(
      settledFirst.model,
      Message.SeenFailed({ slug: 'a', identity: 'anonymous' }),
    )

    expect(settledLast.commands).toHaveLength(1)
    expect(settledLast.model.requestId).toBe(1)
    const retry = update(settledLast.model, Message.RetrySeen())
    expect(retry.commands).toHaveLength(1)
    expect(update(retry.model, Message.RetrySeen())).toEqual({ model: retry.model })
  })

  it.each([
    { name: 'Seen', settle: Message.Seen },
    { name: 'SeenFailed', settle: Message.SeenFailed },
  ])('rejects another identity settling a pending visit with $name', ({ settle }) => {
    const pending = visit(init('another-account'), 'b', 1, neighbours, null).model
    expect(visitState(pending, 'b')).toEqual(VisitState.cases.Pending.make({}))
    expect(update(pending, settle({ slug: 'b', identity: 'anonymous' }))).toEqual({
      model: pending,
    })
    const accepted = update(pending, settle({ slug: 'b', identity: pending.identity }))
    expect(VisitState.guards.Pending(visitState(accepted.model, 'b'))).toBe(false)
    expect(accepted.commands).toHaveLength(1)
  })

  it('waits for an earlier pending visit after the visible visit settles first', () => {
    const first = visit(init('anonymous'), 'b', 1, neighbours, null).model
    const next = visit(first, 'a', 2, null, null).model
    const settledVisible = update(next, Message.Seen({ slug: 'a', identity: 'anonymous' }))
    expect(settledVisible.commands ?? []).toHaveLength(0)
    expect(update(settledVisible.model, Message.RetryNavigation())).toEqual({
      model: settledVisible.model,
    })

    const settledLast = update(
      settledVisible.model,
      Message.Seen({ slug: 'b', identity: 'anonymous' }),
    )

    expect(settledLast.model.current).toBe('a')
    expect(settledLast.commands).toHaveLength(1)
    expect(settledLast.model.requestId).toBe(1)
  })

  it('rejects superseded metadata successes and failures and retains recorded visits on revisit', () => {
    const first = visit(init('anonymous'), 'b', 1, neighbours, null).model
    const saved = update(first, Message.Seen({ slug: 'b', identity: 'anonymous' })).model

    const token = {
      identity: 'anonymous',
      navigationId: saved.navigationId,
      revision: saved.revision,
      requestId: saved.requestId,
    }

    const retry = update(saved, Message.RetryNavigation()).model
    expect(update(retry, Message.LoadedNavigation({ ...token, neighbours }))).toEqual({
      model: retry,
    })
    expect(update(retry, Message.FailedNavigation(token))).toEqual({ model: retry })
    expect(
      update(
        retry,
        Message.LoadedNavigation({
          ...token,
          requestId: retry.requestId,
          identity: 'another-account',
          neighbours,
        }),
      ),
    ).toEqual({ model: retry })
    const revisited = visit(retry, 'b', 2, null, null)
    expect(visitState(revisited.model, 'b')).toEqual(VisitState.cases.Recorded.make({}))
    expect(revisited.model.revision).toBe(saved.revision)
  })

  it('keeps a return point through newer tweets and clears it only after returning', () => {
    const latest = visit(
      { ...init('anonymous'), returnSlug: 'archive' },
      'latest-post',
      1,
      neighbours,
      null,
    ).model

    expect(latest.returnSlug).toBe('archive')
    expect(latest.checkpoint).toBe('latest-post')
    const newer = visit(latest, 'another-new-post', 2, neighbours, null).model
    expect(newer.returnSlug).toBe('archive')
    expect(visit(newer, 'archive', 3, neighbours, null).model.returnSlug).toBeNull()
  })
  it('chooses older unread first, newer second, and only authoritative zero is caught up', () => {
    expect(nextUnread(neighbours)).toEqual(UnreadTarget.Older({ slug: 'a' }))
    expect(nextUnread({ ...neighbours, olderUnread: null })).toEqual(
      UnreadTarget.Newer({ slug: 'c' }),
    )
    expect(
      nextUnread({ ...neighbours, olderUnread: null, newerUnread: null, unreadCount: 0 })._tag,
    ).toBe('CaughtUp')
    expect(
      nextUnread({ ...neighbours, olderUnread: null, newerUnread: undefined, unreadCount: 0 })._tag,
    ).toBe('Unavailable')
    expect(nextUnread(null)._tag).toBe('Unavailable')
    expect(nextUnread({ ...neighbours, olderUnread: null, newerUnread: null })._tag).toBe(
      'Unavailable',
    )
  })

  it('keeps the last known timeline while the next tweet metadata loads', () => {
    const first = visit(init('anonymous'), 'b', 1, neighbours, null)
    const next = visit(first.model, 'a', 2, null, null)
    expect(next.model.neighbours).toBeNull()
    expect(next.model.metadataStatus).toBe('loading')
    expect(next.model.lastKnown).toEqual(neighbours)

    const failed = update(
      next.model,
      Message.FailedNavigation({
        identity: 'anonymous',
        navigationId: 2,
        revision: next.model.revision,
        requestId: next.model.requestId,
      }),
    )

    expect(failed.model.lastKnown).toEqual(neighbours)
  })

  it('rejects unsafe and alias storage targets', () => {
    for (const value of [
      '',
      '/tweet/a',
      'https://host/tweet/a',
      'a?x',
      'a#x',
      'a/b',
      'latest',
      'new',
      '..',
      'a\n',
    ])
      expect(parseCheckpoint(value)).toBeNull()
    expect(parseCheckpoint('valid-tweet')).toBe('valid-tweet')
  })

  it('marks once, reconciles only the current root timeline, and keeps unreadCount unchanged', () => {
    const first = visit(init('anonymous'), 'b', 1, neighbours, '2024-04')
    expect(first.model.checkpoint).toBe('b')
    expect(first.model.neighbours?.timeline[0]?.unread).toBe(2)
    expect(first.model.neighbours?.unreadCount).toBe(2)
    const again = visit(first.model, 'b', 1, null, '2024-04')
    expect(visitState(again.model, 'b')).toEqual(VisitState.cases.Pending.make({}))
    const saved = update(again.model, Message.Seen({ slug: 'b', identity: 'anonymous' }))
    expect(visitState(saved.model, 'b')).toEqual(VisitState.cases.Recorded.make({}))
    expect(update(saved.model, Message.Seen({ slug: 'b', identity: 'anonymous' }))).toEqual({
      model: saved.model,
    })
    const reply = visit(init('anonymous'), 'reply', 1, neighbours, null)
    expect(reply.model.neighbours?.timeline).toEqual(neighbours.timeline)
  })

  it('ignores navigation metadata started before a seen write, even after it completes', () => {
    const visited = visit(init('anonymous'), 'b', 1, neighbours, '2024-04').model
    const saved = update(visited, Message.Seen({ slug: 'b', identity: 'anonymous' })).model

    const stale = Message.LoadedNavigation({
      identity: 'anonymous',
      neighbours,
      navigationId: 1,
      revision: visited.revision,
      requestId: saved.requestId,
    })

    expect(update(saved, stale)).toEqual({ model: saved })

    const fresh = Message.LoadedNavigation({
      identity: 'anonymous',
      neighbours: { ...neighbours, seen: true },
      navigationId: 1,
      revision: saved.revision,
      requestId: saved.requestId,
    })

    expect(update(saved, fresh).model.metadataStatus).toBe('ready')
    expect(update({ ...saved, navigationId: 3 }, fresh).model.metadataStatus).toBe('loading')
  })

  it('makes seen and metadata failures retryable without false exhaustion', () => {
    const visited = visit(init('anonymous'), 'b', 1, neighbours, '2024-04').model
    const failed = update(visited, Message.SeenFailed({ slug: 'b', identity: 'anonymous' })).model
    expect(visitState(failed, 'b')).toEqual(VisitState.cases.Failed.make({}))
    expect(failed.checkpoint).toBe('b')

    const unavailable = update(
      failed,
      Message.FailedNavigation({
        identity: 'anonymous',
        navigationId: 1,
        revision: failed.revision,
        requestId: failed.requestId,
      }),
    ).model

    expect(nextUnread(unavailable.neighbours)._tag).toBe('Unavailable')
    expect(visitState(update(unavailable, Message.RetrySeen()).model, 'b')).toEqual(
      VisitState.cases.Pending.make({}),
    )
    expect(update(failed, Message.Seen({ slug: 'b', identity: 'other' }))).toEqual({
      model: failed,
    })
  })
})
