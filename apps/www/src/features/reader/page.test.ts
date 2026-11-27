import { Component } from '@effect/ui'
import { HtmlCommand } from '@effect/ui/html'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator, Story } from '@effect/ui/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { RecordVisit, ResolveCheckpoint, StoreCheckpoint } from './commands'
import { destination, ReaderPageMessage } from './contracts'
import { initialReader } from './decisions'
import { neighbours, props } from './fixtures.test-support'
import { FollowReaderEntry, TrackReader } from './mounts'
import { ReaderPageNoDeps } from './page'
import { ReaderUnavailable } from './requests'

describe('native reader', () => {
  it.effect(
    'refreshes current unread metadata on focus without navigating or bypassing pending visits',
    () =>
      Effect.gen(function* () {
        const page = props()
        const s = yield* Story.make(ReaderPageNoDeps, page)
        const token = { ...destination(page), generation: 0 }
        s.send(ReaderPageMessage.CommittedReader(token))
          .expectExact(StoreCheckpoint, RecordVisit)
          .keepPending(StoreCheckpoint)
          .keepPending(RecordVisit)
          .loaded('replies', [])
          .send(ReaderPageMessage.FocusedReaderWindow())
        assert.strictEqual(s.model.refresh, 0)
        s.resolve(StoreCheckpoint, Component.noop)
          .resolve(RecordVisit, ReaderPageMessage.SucceededRecordVisit(token))
          .loaded('neighbours', { ...token, revision: 2, refresh: 0, neighbours })
          .send(ReaderPageMessage.FocusedReaderWindow())
          .loaded('neighbours', { ...token, revision: 2, refresh: 1, neighbours })
        assert.strictEqual(s.model.refresh, 1)
        assert.strictEqual(s.model.current, token.slug)
        assert.strictEqual(s.model.checkpoint, token.slug)
        assert.deepStrictEqual(s.pending, [])

        for (const inactive of [
          { ...page, active: false },
          { ...page, principalKnown: false },
          { ...page, url: new URL('https://goosebumps.fm/tweet/stale-target') },
        ]) {
          s.props(inactive).send(ReaderPageMessage.FocusedReaderWindow())
          assert.strictEqual(s.model.refresh, 1)
          assert.deepStrictEqual(s.pending, [])
        }
      }),
  )

  for (const state of [
    { active: false, principalKnown: true },
    { active: true, principalKnown: false },
  ]) {
    it.effect(
      `keeps automatic entry and visit mounts inert when active=${state.active} and principalKnown=${state.principalKnown}`,
      () =>
        Effect.gen(function* () {
          const page = {
            ...props(),
            ...state,
            url: new URL('https://goosebumps.fm/tweets'),
            screen: null,
          }

          const s = yield* HtmlScene.make(ReaderPageNoDeps, page)
          s.expectMount(TrackReader({ ...destination(page), generation: 0, active: false }))
          s.given({ ...initialReader('anonymous'), entryResolved: true, resumeSlug: 'a' })
          s.expectMount(TrackReader({ ...destination(page), generation: 0, active: false }))
          s.expectMount(FollowReaderEntry({ enabled: false, href: '/tweet/a' }))
        }),
    )
  }

  it.effect('reserves initial content without writing a visit before the mount commits', () =>
    Effect.gen(function* () {
      const page = props()
      const s = yield* Story.make(ReaderPageNoDeps, page)
      assert.isNull(s.model.current)
      assert.deepStrictEqual(s.model.visits, {})
      assert.isTrue(s.queryInfo.every((query) => query.args === undefined))
      const token = { ...destination(page), generation: 0 }
      s.send(ReaderPageMessage.CommittedReader(token))
        .expectExact(StoreCheckpoint, RecordVisit)
        .resolve(StoreCheckpoint, Component.noop)
        .resolve(RecordVisit, ReaderPageMessage.SucceededRecordVisit(token))
        .loaded('replies', [])
        .loaded('neighbours', {
          ...token,
          revision: 2,
          refresh: 0,
          neighbours: { ...neighbours, seen: true },
        })
      assert.strictEqual(s.model.current, 'b')
      assert.strictEqual(s.model.visits.b, 'recorded')
    }),
  )

  it.effect('keeps readable server content, native links and reply forms before enhancement', () =>
    Effect.gen(function* () {
      const page = props()
      const s = yield* HtmlScene.make(ReaderPageNoDeps, page)
      s.expectMount(TrackReader({ ...destination(page), generation: 0, active: true }))
        .expect(HtmlLocator.role('heading', { name: 'Tweet b' }))
        .toExist()
        .expect(HtmlLocator.role('link', { name: 'Older tweet' }))
        .toHaveAttribute('href', '/tweet/a')
        .expect(HtmlLocator.role('link', { name: 'Newer tweet' }))
        .toHaveAttribute('href', '/tweet/c')
        .expect(HtmlLocator.role('link', { name: 'a link' }))
        .toHaveAttribute('href', 'https://example.com')
        .expect(HtmlLocator.role('link', { name: 'Sign in' }))
        .toHaveAttribute('href', '/auth/sign-in?returnTo=%2Ftweet%2Fb')
    }),
  )

  it.effect(
    'makes failed seen writes and navigation retryable without showing false caught-up state',
    () =>
      Effect.gen(function* () {
        const page = props()
        const token = { ...destination(page), generation: 0 }
        const s = yield* HtmlScene.make(ReaderPageNoDeps, page)
        s.expectMount(TrackReader({ ...token, active: true }))
          .mounted(TrackReader, ReaderPageMessage.CommittedReader(token))
          .resolve(StoreCheckpoint, Component.noop)
          .resolve(RecordVisit, ReaderPageMessage.FailedRecordVisit(token))
          .loaded('replies', [])
          .loadFailed('neighbours', new ReaderUnavailable({ resource: 'navigation' }))
          .expect(HtmlLocator.role('button', { name: 'Retry saving history' }))
          .toExist()
          .expect(HtmlLocator.role('button', { name: 'Retry navigation' }))
          .toExist()
          .expect(Locator.text('Caught up'))
          .toBeAbsent()
          .click(HtmlLocator.role('button', { name: 'Retry saving history' }))
          .expectExact(RecordVisit)
          .resolve(RecordVisit, ReaderPageMessage.SucceededRecordVisit(token))
          .loaded('neighbours', {
            ...token,
            revision: 4,
            refresh: 0,
            neighbours: { ...neighbours, seen: true },
          })
          .expect(HtmlLocator.role('button', { name: 'Retry saving history' }))
          .toBeAbsent()
      }),
  )

  it.effect(
    'lets earlier writes finish after navigation and refreshes only once every visit settles',
    () =>
      Effect.gen(function* () {
        const first = props()
        const b = { ...destination(first), generation: 0 }
        const s = yield* Story.make(ReaderPageNoDeps, first)
        s.send(ReaderPageMessage.CommittedReader(b))
          .resolve(StoreCheckpoint, Component.noop)
          .loaded('replies', [])
          .keepPending(RecordVisit)
        const second = props('a', 1)
        const a = { ...destination(second), generation: 0 }
        s.props(second)
          .send(ReaderPageMessage.ChangedDestination(a))
          .send(ReaderPageMessage.CommittedReader(a))
          .resolve(StoreCheckpoint, Component.noop)
          .resolve(HtmlCommand.Focus, { found: true })
          .loaded('replies', [])
          .resolve(RecordVisit, ReaderPageMessage.SucceededRecordVisit(b))
        assert.isUndefined(s.queryInfo.find((query) => query.name === 'neighbours')?.args)
        s.resolve(RecordVisit, ReaderPageMessage.SucceededRecordVisit(a)).loaded('neighbours', {
          ...a,
          revision: 4,
          refresh: 0,
          neighbours,
        })
        assert.deepStrictEqual(s.model.visits, { b: 'recorded', a: 'recorded' })
        assert.strictEqual(s.model.current, 'a')
      }),
  )

  it.effect(
    'does not rearm resume intent from an inactive retained archive while the target loads',
    () =>
      Effect.gen(function* () {
        const page = props('a')
        const token = { ...destination(page), generation: 0 }
        const s = yield* Story.make(ReaderPageNoDeps, page)
        s.send(ReaderPageMessage.CommittedReader(token))
          .resolve(StoreCheckpoint, Component.noop)
          .resolve(RecordVisit, ReaderPageMessage.SucceededRecordVisit(token))
          .loaded('replies', [])
          .loaded('neighbours', { ...token, revision: 2, refresh: 0, neighbours })

        const entry = {
          ...page,
          url: new URL('https://goosebumps.fm/tweets'),
          screen: null,
          navigationId: 1,
          active: true,
        }

        s.props(entry).send(ReaderPageMessage.ChangedDestination(destination(entry)))
        assert.strictEqual(s.model.resumeNavigationId, 1)
        const retained = { ...entry, navigationId: 2, active: false }
        s.props(retained).send(ReaderPageMessage.ChangedDestination(destination(retained)))
        assert.strictEqual(s.model.resumeSlug, 'a')
        assert.strictEqual(s.model.resumeNavigationId, 1)

        const missing = {
          ...entry,
          url: page.url,
          navigationId: 2,
          status: 404,
          failure: 'Tweet not found.',
        }

        s.props(missing)
          .send(ReaderPageMessage.ChangedDestination(destination(missing)))
          .expectExact(StoreCheckpoint.make({ identity: 'anonymous', slug: null }))
          .resolve(StoreCheckpoint, Component.noop)
        assert.isNull(s.model.checkpoint)
        assert.isNull(s.model.resumeSlug)
        assert.isTrue(s.model.entryFallback)
        s.send(ReaderPageMessage.ChangedDestination(destination(missing))).expectExact()
      }),
  )

  it.effect(
    'resumes the identity-scoped checkpoint and clears a missing resume target before falling back',
    () =>
      Effect.gen(function* () {
        const entry = {
          ...props(),
          url: new URL('https://goosebumps.fm/tweets'),
          screen: null,
        }

        const s = yield* Story.make(ReaderPageNoDeps, entry)
        s.send(ReaderPageMessage.EnteredReader())
          .expectExact(ResolveCheckpoint)
          .resolve(
            ResolveCheckpoint,
            ReaderPageMessage.ResolvedCheckpoint({
              identity: 'anonymous',
              generation: 0,
              navigationId: 0,
              slug: 'removed-post',
            }),
          )
        assert.strictEqual(s.model.resumeSlug, 'removed-post')

        const missing = {
          ...entry,
          url: new URL('https://goosebumps.fm/tweet/removed-post'),
          navigationId: 1,
          failure: 'Tweet not found.',
          status: 404,
        }

        s.props(missing)
          .send(ReaderPageMessage.ChangedDestination(destination(missing)))
          .expectExact(StoreCheckpoint.make({ identity: 'anonymous', slug: null }))
          .resolve(StoreCheckpoint, Component.noop)
        assert.isTrue(s.model.entryFallback)
        assert.isNull(s.model.checkpoint)
        assert.deepStrictEqual(s.model.visits, {})
      }),
  )

  it.effect('does not record content for a principal that is still being resolved', () =>
    Effect.gen(function* () {
      const page = { ...props(), principalKnown: false }
      const s = yield* Story.make(ReaderPageNoDeps, page)
      s.send(
        ReaderPageMessage.CommittedReader({
          identity: 'anonymous',
          generation: 0,
          navigationId: 0,
          slug: 'b',
        }),
      )
      assert.isNull(s.model.current)
      assert.deepStrictEqual(s.model.visits, {})
      assert.deepStrictEqual(s.pending, [])
    }),
  )

  it.effect('does not commit stale content retained under a newer destination URL', () =>
    Effect.gen(function* () {
      const page = { ...props(), url: new URL('https://goosebumps.fm/tweet/new-destination') }
      const s = yield* Story.make(ReaderPageNoDeps, page)
      s.send(
        ReaderPageMessage.CommittedReader({
          identity: 'anonymous',
          generation: 0,
          navigationId: 0,
          slug: 'b',
        }),
      )
      assert.isNull(s.model.current)
      assert.isNull(s.model.checkpoint)
      assert.deepStrictEqual(s.model.visits, {})
      assert.deepStrictEqual(s.pending, [])
    }),
  )
})
