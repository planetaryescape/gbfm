import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { MicroPostScreenResponse } from '@gbfm/api/post'
import { Effect, Layer, Predicate, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { screen } from '../features/reader/fixtures.test-support'
import { PerformSpotify, ReadSpotifyStatus } from '../features/spotify/commands'
import { SpotifyProviderMessage, SpotifyProviderModel } from '../features/spotify/domain'
import type { SpotifyStatus } from '../spotify/connection'
import { RoutedApplicationMessage, RoutedApplicationNoDeps } from './routed-application'
import {
  makeReaderLifetimeFixture,
  readerDocument,
  runReaderLifetime,
} from './routed-reader-lifetime.test-support'

const musicDocument = (slug: string) => {
  const initial = screen(slug)

  return {
    ...readerDocument(`/tweet/${slug}`),
    tweet: Schema.decodeUnknownSync(MicroPostScreenResponse)({
      ...initial,
      post: {
        ...initial.post,
        music: {
          entity: {
            id: 'record',
            type: 'album',
            title: 'Record',
            artistNames: ['Artist'],
            coverImageUrl: null,
          },
          links: [
            { platform: 'spotify', url: 'https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv' },
          ],
        },
      },
    }),
  }
}

describe('retirement: actual Root Spotify navigation synchronization', () => {
  it('starts a fresh status observation on tweet navigation and ignores the delayed pre-navigation result', async () => {
    const fixture = makeReaderLifetimeFixture('/tweet/a')
    fixture.pages.set('/tweet/a', [Response.json(musicDocument('a'))])
    fixture.pages.set('/tweet/b', [Response.json(musicDocument('b'))])
    const delayed = Promise.withResolvers<typeof SpotifyStatus.Type>()
    const reads: Array<{ identity: string; revision: number }> = []

    const status = ReadSpotifyStatus.toLayer((args) => {
      reads.push(args)

      return reads.length === 1
        ? Effect.promise(() => delayed.promise)
        : Effect.succeed({ connected: true, name: 'Fresh navigation account' })
    })

    await runReaderLifetime(
      { layer: Layer.merge(fixture.layer, status) },
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(reads).toHaveLength(1)
        yield* router.navigate('/tweet/b')
        yield* TestHost.settle
        const afterNavigation = [...reads]
        delayed.resolve({ connected: false, name: 'Obsolete account' })
        yield* TestHost.settle
        expect.soft(afterNavigation).toHaveLength(2)
        expect
          .soft(afterNavigation[1]?.revision)
          .toBeGreaterThan(afterNavigation[0]?.revision ?? -1)
        expect.soft(root.text()).not.toContain('Obsolete account')
        expect.soft(root.query(Locator.text('Play on Spotify'))).toBeDefined()
        root.send(RoutedApplicationMessage.ChangedPage())
        root.send(RoutedApplicationMessage.ChangedPage())
        yield* TestHost.settle
        expect(reads).toHaveLength(2)

        for (const name of ['SpotifyProvider', 'PlayerProvider'])
          expect(
            root
              .log()
              .filter(
                (entry) =>
                  Predicate.isTagged(entry, 'Mounted') && entry.path.endsWith(`/${name}[]`),
              ),
          ).toHaveLength(1)
      }),
    )
  })

  it.each(['connect', 'play'])(
    'accepted tweet navigation preserves pending %s ownership and never repeats the operation',
    async (action) => {
      const fixture = makeReaderLifetimeFixture('/tweet/a')
      fixture.pages.set('/tweet/a', [Response.json(musicDocument('a'))])
      fixture.pages.set('/tweet/b', [Response.json(musicDocument('b'))])
      const gate = Promise.withResolvers<void>()
      let reads = 0
      const operations: Array<string> = []

      const layer = Layer.merge(
        fixture.layer,
        Layer.merge(
          ReadSpotifyStatus.toLayer(() => {
            reads++

            return Effect.succeed({
              connected: action === 'play' && reads === 1,
              name: 'Fixture account',
            })
          }),
          PerformSpotify.toLayer((args) => {
            operations.push(args.action)

            return Effect.promise(() => gate.promise).pipe(
              Effect.map(() =>
                SpotifyProviderMessage.CompletedOperation({
                  ...args,
                  status: null,
                  notice: 'Accepted operation completed',
                }),
              ),
            )
          }),
        ),
      )

      await runReaderLifetime(
        { layer },
        Effect.gen(function* () {
          const router = yield* Router.Router
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)

          const state = () => {
            const entry = root
              .log()
              .findLast(
                (entry) =>
                  (Predicate.isTagged(entry, 'Mounted') || Predicate.isTagged(entry, 'Update')) &&
                  entry.path.endsWith('/SpotifyProvider[]'),
              )

            if (
              !entry ||
              (!Predicate.isTagged(entry, 'Mounted') && !Predicate.isTagged(entry, 'Update'))
            )
              throw new Error('Missing actual Spotify provider')

            return Schema.decodeUnknownSync(SpotifyProviderModel)(entry.model)
          }

          yield* TestHost.settle
          Locator.fire(
            root.get(Locator.text(action === 'connect' ? 'Connect Spotify' : 'Play on Spotify')),
            'click',
          )
          yield* TestHost.settle
          const operation = state().operation
          expect(operation?.action).toBe(action)
          yield* router.navigate('/tweet/b')
          yield* TestHost.settle
          expect(state().operation).toEqual(operation)
          expect(operations).toEqual([action])
          expect(reads).toBe(action === 'connect' ? 1 : 2)
          gate.resolve()
          yield* TestHost.settle
          expect(state().operation).toBeNull()
          expect(state().notice).toBe('Accepted operation completed')
          expect(operations).toEqual([action])
        }),
      )
    },
  )

  it('anonymous Root entering Integrations can subsequently Connect without a stranded pending operation', async () => {
    const fixture = makeReaderLifetimeFixture('/dashboard/integrations')
    const operations: Array<string> = []

    const spotify = Layer.merge(
      ReadSpotifyStatus.toLayer(() => Effect.succeed({ connected: false, name: '' })),
      PerformSpotify.toLayer((args) =>
        Effect.sync(() => {
          operations.push(args.action)

          return SpotifyProviderMessage.CompletedOperation({
            ...args,
            status: { connected: true, name: 'Connected fixture' },
            notice: 'Connected',
          })
        }),
      ),
    )

    await runReaderLifetime(
      { layer: Layer.merge(fixture.layer, spotify) },
      Effect.gen(function* () {
        const router = yield* Router.Router
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(operations).toEqual([])

        const state = () => {
          const entry = root
            .log()
            .findLast(
              (entry) =>
                (Predicate.isTagged(entry, 'Mounted') || Predicate.isTagged(entry, 'Update')) &&
                entry.path.endsWith('/SpotifyProvider[]'),
            )

          if (
            !entry ||
            (!Predicate.isTagged(entry, 'Mounted') && !Predicate.isTagged(entry, 'Update'))
          )
            throw new Error('Missing actual Spotify provider')

          return Schema.decodeUnknownSync(SpotifyProviderModel)(entry.model)
        }

        expect(state().operation).toBeNull()
        fixture.pages.set('/tweet/a', [Response.json(musicDocument('a'))])
        yield* router.navigate('/tweet/a')
        yield* TestHost.settle
        Locator.fire(root.get(Locator.text('Connect Spotify')), 'click')
        yield* TestHost.settle
        expect(operations).toEqual(['connect'])
        expect(state().operation).toBeNull()
        expect(state().identity).toBe('anonymous')
      }),
    )
  })
})
