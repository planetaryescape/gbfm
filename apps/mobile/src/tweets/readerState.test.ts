import { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import { MicroPostScreenResponse } from '@gbfm/api/post'
import { Schema } from 'effect'
import { expect, test } from 'vitest'

import {
  initialReaderState,
  readerAcceptsAction,
  nextUnread,
  ReaderEvent,
  readerMonth,
  reduceReader,
} from './readerState'

const navigation = (
  overrides: {
    readonly olderUnread?: null
    readonly newerUnread?: null
    readonly unreadCount?: number
  } = {},
) =>
  Schema.decodeUnknownSync(MicroPostNeighboursResponse)({
    newer: 'newer',
    older: 'older',
    olderUnread: 'older-unread',
    newerUnread: 'newer-unread',
    seen: true,
    unreadCount: 4,
    timeline: [],
    ...overrides,
  })

test('next unread follows web priority: older first, then newer', () => {
  expect(nextUnread(navigation())).toEqual({ kind: 'older', slug: 'older-unread' })
  expect(nextUnread(navigation({ olderUnread: null }))).toEqual({
    kind: 'newer',
    slug: 'newer-unread',
  })
})

test('caught up requires the complete server contract, not missing data or a failed request', () => {
  const { newerUnread: _missing, ...incomplete } = navigation({ olderUnread: null, unreadCount: 0 })

  expect(nextUnread(null)).toEqual({ kind: 'unavailable' })
  expect(nextUnread(incomplete)).toEqual({ kind: 'unavailable' })
  expect(nextUnread(navigation({ olderUnread: null, newerUnread: null, unreadCount: 0 }))).toEqual({
    kind: 'caught-up',
  })
})

test('late navigation and errors from an earlier tweet cannot replace the new request', () => {
  const state = reduceReader(initialReaderState, ReaderEvent.Started({ request: 2 }))

  expect(
    reduceReader(state, ReaderEvent.Navigation({ request: 1, navigation: navigation() })),
  ).toBe(state)
  expect(reduceReader(state, ReaderEvent.Failed({ request: 1 }))).toBe(state)
  expect(reduceReader(state, ReaderEvent.Progress({ request: 1, failed: true }))).toBe(state)
  expect(
    reduceReader(state, ReaderEvent.Notice({ request: 1, message: 'old account result' })),
  ).toBe(state)
})

test('a new request clears the previous account/tweet navigation and notices', () => {
  const state = reduceReader(
    initialReaderState,
    ReaderEvent.Navigation({ request: 0, navigation: navigation() }),
  )

  const failed = reduceReader(state, ReaderEvent.Progress({ request: 0, failed: true }))
  const next = reduceReader(failed, ReaderEvent.Started({ request: 1 }))

  expect(next.navigation).toBeNull()
  expect(next.progressFailed).toBe(false)
  expect(next.status).toBe('loading')
})

test('navigation failure remains retryable rather than caught up', () => {
  const state = reduceReader(initialReaderState, ReaderEvent.NavigationFailed({ request: 0 }))

  expect(state.navigationStatus).toBe('error')
  expect(nextUnread(state.navigation)).toEqual({ kind: 'unavailable' })
})

test('month labels use UTC like the web timeline', () => {
  expect(readerMonth('2026-10-01T00:00:00Z')).toBe('Oct 2026')
})

test('delayed reset confirmations cannot act after blur, account unmount, or a newer request', () => {
  const post = MicroPostScreenResponse.fields.post.make({
    id: 'one',
    slug: 'one',
    title: null,
    description: null,
    thumbnailUrl: null,
    content: null,
    draft: false,
    tags: [],
    type: 'micro',
    musicEntityType: null,
    musicEntityId: null,
    parentPostId: null,
    rootPostId: null,
    depth: 0,
    quotedPostId: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    compiledContent: '',
    music: null,
  })

  const screen = MicroPostScreenResponse.make({ post, root: post, replies: [], quote: null })
  const ready = reduceReader(initialReaderState, ReaderEvent.Loaded({ request: 0, screen }))

  const opening = reduceReader(ready, ReaderEvent.Started({ request: 1 }))
  expect(opening.screen).toBe(screen)
  expect(opening.status).toBe('loading')
  expect(opening.navigation).toBeNull()
  expect(readerAcceptsAction(opening, 1, true)).toBe(false)
  const failed = reduceReader(opening, ReaderEvent.Failed({ request: 1 }))
  expect(failed.screen).toBe(screen)
  expect(failed.status).toBe('error')
  const missing = reduceReader(opening, ReaderEvent.Loaded({ request: 1, screen: null }))
  expect(missing.screen).toBe(screen)
  expect(missing.status).toBe('error')
  expect(reduceReader(opening, ReaderEvent.Failed({ request: 0 }))).toBe(opening)

  expect(readerAcceptsAction(ready, 0, true)).toBe(true)
  expect(readerAcceptsAction(ready, 0, false)).toBe(false)
  expect(readerAcceptsAction(ready, 1, true)).toBe(false)
  expect(readerAcceptsAction(initialReaderState, 0, true)).toBe(false)
})
