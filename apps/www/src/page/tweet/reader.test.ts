import { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { init, Message, nextUnread, parseCheckpoint, UnreadTarget, update, visit } from './reader'

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
    expect(again.model.pending).toEqual(['b'])
    const saved = update(again.model, Message.Seen({ slug: 'b', identity: 'anonymous' }))
    expect(saved.model.pending).toEqual([])
    expect(saved.model.recorded).toEqual(['b'])
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
    expect(failed.failed).toEqual(['b'])
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
    expect(update(unavailable, Message.RetrySeen()).model.pending).toEqual(['b'])
    expect(update(failed, Message.Seen({ slug: 'b', identity: 'other' }))).toEqual({
      model: failed,
    })
  })
})
