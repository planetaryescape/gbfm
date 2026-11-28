import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { describe, expect, it } from 'vitest'

import { PageDocument } from '../domain/page'
import { pageFixture } from '../server/page-fixture.test-support'
import {
  RoutedApplicationMessage,
  RoutedApplicationNoDeps,
  visiblePageDocument,
} from './routed-application'
import {
  makeReaderLifetimeFixture,
  pumpReaderUntil,
  readerDocument,
  runReaderLifetime,
} from './routed-reader-lifetime.test-support'

describe('retirement: anonymous public retention privacy boundaries', () => {
  const identity = { principalId: null, known: true, epoch: 0 }
  const source = PageDocument.make({ ...readerDocument('/about'), principalKnown: true })
  const target = new URL('/privacy', source.url)
  const pending = AsyncResult.initial<PageDocument>(true)

  it('retains only an explicitly verified anonymous source in the same realm and origin', () => {
    const retained = { page: source, realm: 'first', currentRealm: 'first' }
    expect(visiblePageDocument(pending, target, identity, retained)).toBe(source)

    for (const state of [
      { ...retained, currentRealm: 'second' },
      { ...retained, realm: null },
      { ...retained, page: PageDocument.make({ ...source, principalKnown: false }) },
      { ...retained, page: PageDocument.make({ ...source, principalKnown: undefined }) },
      {
        ...retained,
        page: PageDocument.make({
          ...source,
          url: new URL('/listening?mix=private', source.url).href,
        }),
      },
      {
        ...retained,
        page: PageDocument.make({
          ...source,
          principal: { id: 'owner-a', name: 'Private owner', username: null, role: null },
        }),
      },
    ])
      expect(visiblePageDocument(pending, target, identity, state)).toBeUndefined()
    expect(
      visiblePageDocument(pending, target, { ...identity, known: false }, retained),
    ).toBeUndefined()
    expect(
      visiblePageDocument(pending, target, { ...identity, principalId: 'owner-b' }, retained),
    ).toBeUndefined()
    expect(
      visiblePageDocument(pending, new URL('/listening', target), identity, retained),
    ).toBeUndefined()
    expect(
      visiblePageDocument(pending, new URL('https://foreign.test/privacy'), identity, retained),
    ).toBeUndefined()
  })

  it.each(['personalized', 'source-unknown', 'identity-unknown', 'private-destination'])(
    'clears old content and head during pending and failed navigation for %s',
    async (mode) => {
      const fixture = makeReaderLifetimeFixture('/about')

      const initial = {
        ...readerDocument('/about'),
        title: 'Confidential source marker',
        metadata: null,
        principalKnown: mode !== 'source-unknown',
        principal:
          mode === 'personalized'
            ? { id: 'owner-a', name: 'Private owner', username: null, role: null }
            : null,
      }

      fixture.pages.set('/about', [Response.json(initial)])
      const destination = mode === 'private-destination' ? '/dashboard/integrations' : '/privacy'
      const response = Promise.withResolvers<Response>()
      fixture.pages.set(destination, [response.promise])

      const props = {
        ...fixture.props,
        identity: {
          principalId: initial.principal?.id ?? null,
          known: mode !== 'identity-unknown',
          epoch: 0,
        },
      }

      await runReaderLifetime(
        fixture,
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, props)
          yield* TestHost.settle

          if (mode === 'source-unknown')
            expect(root.text()).not.toContain('Confidential source marker')
          else expect(root.text()).toContain('Confidential source marker')
          yield* router.navigate(destination)
          yield* pumpReaderUntil(() => fixture.pageRequests.includes(destination))
          expect(root.text()).not.toContain('Confidential source marker')
          expect(root.head<{ title: string }>().title).not.toContain('Confidential source marker')
          response.reject(new Error('Disposable failed destination'))
          yield* TestHost.settle
          expect(root.text()).not.toContain('Confidential source marker')
          expect(root.head<{ title: string }>().title).not.toContain('Confidential source marker')
        }),
      )
    },
  )

  it('drops retained public content immediately on explicit authentication uncertainty and account replacement', async () => {
    const fixture = makeReaderLifetimeFixture('/about')
    fixture.pages.set('/about', [
      Response.json({
        ...readerDocument('/about'),
        title: 'Previously public marker',
        metadata: null,
      }),
    ])
    const response = Promise.withResolvers<Response>()
    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(root.text()).toContain('Previously public marker')
        fixture.pages.set('/about', [response.promise])
        root.send(RoutedApplicationMessage.ChangedAuthentication())
        yield* pumpReaderUntil(
          () => fixture.pageRequests.filter((path) => path === '/about').length === 2,
        )
        expect(root.text()).not.toContain('Previously public marker')
        expect(root.model()?.retainedPublicPath).toBeNull()
        response.resolve(
          Response.json({
            ...pageFixture('/about').flags,
            title: 'Verified replacement',
            principalKnown: true,
            principal: { id: 'owner-b', name: 'Owner B', username: null, role: null },
          }),
        )
        yield* TestHost.settle
        expect(root.text()).not.toContain('Previously public marker')
        expect(root.model()?.retainedPublicPath).toBeNull()
        expect(root.query(Locator.attr('data-reader-status', 'error'))).toBeUndefined()
      }),
    )
  })

  it('never serves another Root realm from the same native query environment', async () => {
    const fixture = makeReaderLifetimeFixture('/about')
    fixture.pages.set('/about', [
      Response.json({
        ...readerDocument('/about'),
        title: 'First realm only',
        metadata: null,
      }),
    ])
    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const first = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(first.text()).toContain('First realm only')

        const second = yield* TestHost.mount(RoutedApplicationNoDeps, {
          ...fixture.props,
          realm: 'independent-request-realm',
        })

        yield* TestHost.settle
        expect(second.text()).not.toContain('First realm only')
        expect(second.head<{ title: string }>().title).not.toContain('First realm only')
        expect(second.model()?.retainedPublicPath).toBeNull()
        expect(fixture.pageRequests).toEqual(['/about'])
      }),
    )
  })
})
