import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { RichContentDocument } from '@gbfm/rich-content/schema'
import { parseRichContent } from '@gbfm/rich-content/source'
import { makeStaticSiteMetadata } from '@gbfm/site-metadata'
import { Effect, Layer, Schema } from 'effect'
import { HttpClient } from 'effect/http'
import { expect, it } from 'vitest'

import { GetPage } from '../../app/page-query'
import { AppRoute } from '../../app/route'
import {
  AppBootstrap,
  FollowPageLocation,
  InvalidatePages,
  ReadRouteLocation,
  ReportNavigation,
  RoutedApplicationNoDeps,
} from '../../app/routed-application'
import { nativePlayerServerLayer } from '../player/provider'
import { LoadMembership, SaveMembership } from '../public-actions/commands'
import { MembershipMessage } from '../public-actions/domain'
import { PerformSpotify, ReadSpotifyStatus } from '../spotify/commands'
import { SpotifyProviderMessage } from '../spotify/domain'
import { publicMix, publicPage } from './fixtures'

const parsed = Schema.decodeUnknownSync(RichContentDocument)(
  parseRichContent('Intro.\n\n## Chapter\n\n### Record\n\nA thought.').document,
)

const item = {
  ...publicMix,
  richContent: RichContentDocument.make({ ...parsed, layout: 'spotlight' }),
}

for (const at of ['', 'garbage', '2.3']) {
  it(`canonicalizes initial at=${JSON.stringify(at)} through the native Root and Router without changing its anonymous realm`, async () => {
    const descriptors = new Map(
      ['window', 'localStorage', 'cancelAnimationFrame'].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    )

    const stored = new Map<string, string>()
    stored.set(
      'gbfm:spotlight:/editorial/night-mix',
      JSON.stringify({ at: '1.1', seen: ['intro', 'obsolete'] }),
    )
    Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: () => {},
    })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    })
    const path = `/editorial/night-mix?keep=one&at=${encodeURIComponent(at)}&keep=two`

    const props = AppBootstrap.make({
      url: new URL(path, 'https://goosebumps.fm'),
      metadata: makeStaticSiteMetadata('Night Mix', 'Fixture', path),
      identity: { principalId: null, known: true, epoch: 7 },
      realm: 'spotlight-router-regression',
    })

    const requests: Array<{ path: string; epoch: number; realm: string }> = []
    const router = Router.memory({ routes: AppRoute, url: path })

    const layers = Layer.mergeAll(
      TestHost.layer(),
      nativePlayerServerLayer,
      GetPage.toLayer((args) =>
        Effect.sync(() => {
          requests.push({ path: args.path, epoch: args.identity.epoch, realm: args.realm })

          return publicPage(args.path, [item])
        }),
      ),
      LoadMembership.toLayer((args) =>
        Effect.succeed(
          MembershipMessage.SucceededLoadMembership({ ...args, active: false, revision: 0 }),
        ),
      ),
      SaveMembership.toLayer(() => Effect.die(new Error('Unexpected membership mutation'))),
      ReadSpotifyStatus.toLayer(() => Effect.succeed({ connected: false, name: '' })),
      PerformSpotify.toLayer(({ identity, requestId, revision }) =>
        Effect.succeed(
          SpotifyProviderMessage.CompletedOperation({
            identity,
            requestId,
            revision,
            status: null,
            notice: '',
          }),
        ),
      ),
      Layer.mergeAll(FollowPageLocation.layer, ReadRouteLocation.layer, InvalidatePages.layer).pipe(
        Layer.provideMerge(router),
      ),
      ReportNavigation.toLayer(() => Effect.void),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die(new Error('Unexpected external HTTP request'))),
      ),
    )

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(layers)

            return yield* Effect.gen(function* () {
              const router = yield* Router.Router
              const root = yield* TestHost.mount(RoutedApplicationNoDeps, props)
              yield* TestHost.settle
              const model = root.model()

              if (!model) throw new Error('Native Root did not initialize')
              expect(router.location().url).toBe('/editorial/night-mix?keep=one&keep=two')
              expect(AppRoute.print(model.route)).toBe(router.location().url)
              expect(model.identity).toEqual(props.identity)
              expect(root.text()).toContain('Night Mix')
              expect(root.get(Locator.text('Start'))).toBeDefined()
              expect(JSON.parse(stored.get('gbfm:spotlight:/editorial/night-mix') ?? '{}')).toEqual(
                {
                  at: null,
                  seen: ['intro'],
                },
              )
              expect(requests.map((request) => request.path)).toContain(
                '/editorial/night-mix?keep=one&keep=two',
              )
              expect(
                requests.every((request) => request.epoch === 7 && request.realm === props.realm),
              ).toBe(true)
            }).pipe(Effect.provide(context))
          }),
        ),
      )
    } finally {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  })
}
