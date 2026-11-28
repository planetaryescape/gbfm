import { Component } from '@effect/ui'
import { HtmlScene } from '@effect/ui/html/testing'
import { Story } from '@effect/ui/testing'
import { it, expect } from '@effect/vitest'
import { Effect } from 'effect'

import { NavigateSearch, SearchDialogEvents, SearchDialogNoDeps, SearchMessage } from './dialog'
import type { SearchQueryScope } from './scope'

export const scope = {
  realm: 'search-fixture',
  principalId: 'account-a',
  known: true,
  epoch: 0,
  origin: 'https://goosebumps.fm',
} satisfies SearchQueryScope

const searchProps = (open: boolean) => ({ open, queryScope: scope })

it('keyboard shortcuts request controlled search visibility without taking slash from editable controls', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(SearchDialogNoDeps, searchProps(false))
    s.fireDocument('keydown', { key: '/', editable: true }).expectIgnored()
    s.fireDocument('keydown', { key: 'k', ctrl: true, editable: true })
      .expectDefaultPrevented()
      .emitted(SearchDialogEvents.RequestedOpen())
    expect(s.defaultPrevented).toBe(true)
  }).pipe(Effect.scoped, Effect.runPromise))

it('closing and reopening controlled search changes query identity and clears the previous query', () =>
  Effect.gen(function* () {
    const s = yield* Story.make(SearchDialogNoDeps, searchProps(false))
    s.send(SearchMessage.RequestedOpenSearch())
      .emitted(SearchDialogEvents.RequestedOpen())
      .props(searchProps(true))
      .send(SearchMessage.UpdatedSearchQuery({ query: 'ambient' }))
      .loaded('results', { shows: [], audio: [], posts: [] })
      .send(SearchMessage.RequestedCloseSearch())
      .emitted(SearchDialogEvents.RequestedClose())
      .props(searchProps(false))
      .send(SearchMessage.RequestedOpenSearch())
      .emitted(SearchDialogEvents.RequestedOpen())
      .props(searchProps(true))
      .send(SearchMessage.SubmittedSearch())
      .expectNone()
    expect(s.model.query).toBe('')
    expect(s.model.generation).toBe(3)
  }).pipe(Effect.scoped, Effect.runPromise))

it('Enter navigates to the first routable result in show/audio/post order and requests closure', () =>
  Effect.gen(function* () {
    const s = yield* Story.make(SearchDialogNoDeps, searchProps(true))
    s.send(SearchMessage.UpdatedSearchQuery({ query: 'night' }))
      .loaded('results', {
        shows: [
          {
            id: 'show',
            slug: 'night radio',
            title: 'Night radio',
            type: 'show',
            thumbnailUrl: null,
            description: null,
          },
        ],
        audio: [],
        posts: [],
      })
      .send(SearchMessage.SubmittedSearch())
      .emitted(SearchDialogEvents.RequestedClose())
      .expectExact(NavigateSearch.make({ href: '/shows/night%20radio', origin: scope.origin }))
      .resolve(NavigateSearch, Component.noop)
    expect(s.model.query).toBe('')
  }).pipe(Effect.scoped, Effect.runPromise))

it('a new query cannot submit results from the previous query', () =>
  Effect.gen(function* () {
    const s = yield* Story.make(SearchDialogNoDeps, searchProps(true))
    s.send(SearchMessage.UpdatedSearchQuery({ query: 'first' }))
      .loaded('results', {
        shows: [
          {
            id: 'old',
            slug: 'old',
            title: 'Old',
            type: 'show',
            thumbnailUrl: null,
            description: null,
          },
        ],
        audio: [],
        posts: [],
      })
      .send(SearchMessage.UpdatedSearchQuery({ query: 'second' }))
      .keepPending('results')
      .send(SearchMessage.SubmittedSearch())
      .expectNone()
    expect(s.model.query).toBe('second')
    expect(s.queries.results._tag).toBe('Initial')
  }).pipe(Effect.scoped, Effect.runPromise))

it('an externally controlled close clears the query and invalidates in-flight results', () =>
  Effect.gen(function* () {
    const s = yield* Story.make(SearchDialogNoDeps, searchProps(true))
    s.send(SearchMessage.UpdatedSearchQuery({ query: 'pending' }))
      .keepPending('results')
      .props(searchProps(false))
      .subscription('ObserveClosedSearch', SearchMessage.ClosedSearchExternally())
      .expectNone()
    expect(s.model.query).toBe('')
    expect(s.model.generation).toBe(1)
  }).pipe(Effect.scoped, Effect.runPromise))
