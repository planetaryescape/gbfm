import { describe, expect, it } from '@effect/vitest'

import {
  commitVisit,
  hasPendingVisits,
  initialReader,
  nextUnread,
  reserveVisit,
  settleVisit,
  UnreadTarget,
  visitedNeighbours,
} from './decisions'
import { neighbours } from './fixtures.test-support'

const first = { identity: 'anonymous', slug: 'b', navigationId: 1, generation: 0 }

describe('reader reservations', () => {
  it('does not record a reserved destination before its real content commits', () => {
    const reserved = reserveVisit(initialReader(first.identity), first)
    expect(reserved.checkpoint).toBeNull()
    expect(reserved.current).toBeNull()
    expect(reserved.visits).toEqual({})
    const superseded = reserveVisit(reserved, { ...first, slug: 'a', navigationId: 2 })
    expect(commitVisit(superseded, first)).toBe(superseded)
    expect(superseded.visits).toEqual({})
  })

  it('commits once, waits for every pending visit, and accepts an earlier visit finishing late', () => {
    const b = commitVisit(reserveVisit(initialReader('anonymous'), first), first)
    expect(b.checkpoint).toBe('b')
    expect(b.visits).toEqual({ b: 'pending' })
    expect(commitVisit(b, first)).toBe(b)
    const second = { ...first, slug: 'a', navigationId: 2 }
    const a = commitVisit(reserveVisit(b, second), second)
    const settledVisible = settleVisit(a, second, true)
    expect(hasPendingVisits(settledVisible)).toBe(true)
    const settledAll = settleVisit(settledVisible, first, false)
    expect(hasPendingVisits(settledAll)).toBe(false)
    expect(settledAll.current).toBe('a')
    expect(settledAll.visits).toEqual({ b: 'failed', a: 'recorded' })
    expect(settleVisit(settledAll, first, true)).toBe(settledAll)
  })

  it('rejects old responses even after an anonymous to account to anonymous identity cycle', () => {
    const original = commitVisit(reserveVisit(initialReader('anonymous'), first), first)
    const account = reserveVisit(original, { ...first, identity: 'account' })
    const anonymous = reserveVisit(account, first)
    const current = commitVisit(anonymous, { ...first, generation: 2 })
    expect(current.visits).toEqual({ b: 'pending' })
    expect(settleVisit(current, first, true)).toBe(current)
    expect(commitVisit(anonymous, first)).toBe(anonymous)
    expect(settleVisit(current, { ...first, generation: 2 }, true).visits.b).toBe('recorded')
  })

  it('retains the archive return point until it is actually committed again', () => {
    const initial = { ...initialReader('anonymous'), returnSlug: 'archive' }
    const latest = commitVisit(reserveVisit(initial, first), first)
    expect(latest.returnSlug).toBe('archive')
    const archive = { ...first, slug: 'archive', navigationId: 3 }
    const reserved = reserveVisit(latest, archive)
    expect(reserved.returnSlug).toBe('archive')
    expect(commitVisit(reserved, archive).returnSlug).toBeNull()
  })

  it('ignores an earlier failed attempt settling after the same slug is visited again', () => {
    const pending = commitVisit(reserveVisit(initialReader('anonymous'), first), first)
    const failed = settleVisit(pending, first, false)
    const revisitedToken = { ...first, navigationId: 3 }
    const revisited = commitVisit(reserveVisit(failed, revisitedToken), revisitedToken)
    expect(revisited.visits.b).toBe('pending')
    expect(settleVisit(revisited, first, true)).toBe(revisited)
    expect(settleVisit(revisited, revisitedToken, true).visits.b).toBe('recorded')
  })

  it('never claims exhaustion from missing or partial metadata', () => {
    expect(nextUnread(neighbours)).toEqual(UnreadTarget.Older({ slug: 'a' }))
    expect(nextUnread({ ...neighbours, olderUnread: null })).toEqual(
      UnreadTarget.Newer({ slug: 'c' }),
    )
    expect(
      nextUnread({ ...neighbours, olderUnread: null, newerUnread: null, unreadCount: 0 }),
    ).toEqual(UnreadTarget.CaughtUp())
    expect(
      nextUnread({ ...neighbours, olderUnread: null, newerUnread: undefined, unreadCount: 0 }),
    ).toEqual(UnreadTarget.Unavailable())
    expect(nextUnread(null)).toEqual(UnreadTarget.Unavailable())
  })

  it('reconciles only the visited root month without guessing the authoritative unread count', () => {
    const visited = visitedNeighbours(neighbours, '2024-04')
    expect(visited?.seen).toBe(true)
    expect(visited?.timeline[0]?.unread).toBe(2)
    expect(visited?.unreadCount).toBe(2)
    expect(visitedNeighbours(visited, '2024-04')).toBe(visited)
    expect(visitedNeighbours(neighbours, null)).toBe(neighbours)
  })
})
