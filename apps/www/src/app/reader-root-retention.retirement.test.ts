import { Locator, TestHost } from '@effect/ui/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { RoutedApplicationMessage, RoutedApplicationNoDeps } from './routed-application'
import { documents, fieldValue, input, routedLayer } from './routed-feature-lifetime.test-support'
import {
  activateRenderedReader,
  makeReaderLifetimeFixture,
  pumpReaderUntil,
  readerState,
  runReaderLifetime,
} from './routed-reader-lifetime.test-support'

describe('retirement: exact Root revalidation retention', () => {
  it('same-document revalidation preserves unsaved Creator writing', async () => {
    const fixture = documents('/new/mix')
    const fetch: typeof globalThis.fetch = async () => new Response(null, { status: 404 })
    await runReaderLifetime(
      { layer: routedLayer(fixture, fetch) },
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        input(root, 'title', 'Unsaved writing must survive')
        yield* TestHost.settle
        expect(fieldValue(root, 'title')).toBe('Unsaved writing must survive')
        const held = fixture.holdNext()
        root.send(RoutedApplicationMessage.ClickedRetryPage())
        yield* pumpReaderUntil(() => fixture.requests.length === 2)
        held.resume()
        yield* TestHost.settle
        expect(root.query(Locator.attr('name', 'title'))).toBeDefined()
        expect(fieldValue(root, 'title')).toBe('Unsaved writing must survive')
      }),
    )
  })

  it('identical concrete document revalidation preserves the accepted checkpoint without another seen write', async () => {
    const fixture = makeReaderLifetimeFixture('/tweet/a')
    await runReaderLifetime(
      fixture,
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(activateRenderedReader(root, '/tweet/a')).toBe(true)
        yield* TestHost.settle
        expect(fixture.storage.get('anonymous')).toBe('a')
        expect(readerState(root).model.checkpoint).toBe('a')
        root.send(RoutedApplicationMessage.ClickedRetryPage())
        yield* TestHost.settle
        expect(activateRenderedReader(root, '/tweet/a')).toBe(true)
        yield* TestHost.settle
        expect(readerState(root).model.checkpoint).toBe('a')
        expect(fixture.storage.get('anonymous')).toBe('a')
        expect(fixture.apiRequests.filter((path) => path.endsWith('/seen'))).toHaveLength(1)
      }),
    )
  })
})
