import { Command, Query, Router } from '@effect/ui'
import { Html, HtmlServer } from '@effect/ui/html'
import { TestHost } from '@effect/ui/testing'
import { Effect, Fiber, Layer, Option, Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { describe, expect, it } from 'vitest'

import {
  browserPageLayer,
  GetPage,
  initialPageIdentity,
  pageQueryArgs,
  PageQueryArgs,
  pageIdentityForNavigation,
  serverPageLayer,
  type ServerPageOptions,
} from '../app/page-query'
import { AppRoute, canPrefetchPage, pageRoute, patchPageSearch, routeFromUrl } from '../app/route'
import { parseRoute } from '../route'
import { PageDocument } from './page'

const runWithLayer = <A, E, R>(program: Effect.Effect<A, E, R>, layer: Layer.Layer<R>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer)

        return yield* Effect.provide(program, context)
      }),
    ),
  )

const queryArgs = (...args: Parameters<typeof pageQueryArgs>) => {
  const result = pageQueryArgs(...args)

  if (result === undefined) throw new Error('Invalid page query fixture')

  return result
}

const document = (principalId: string | null = null) =>
  PageDocument.make({
    url: 'https://goosebumps.fm/dashboard/favorites',
    status: 200,
    principal: principalId ? { id: principalId, name: null, username: null, role: null } : null,
    principalKnown: true,
    items: [],
    title: 'Favorites',
    description: '',
    requestId: 'request-1',
    renderedAt: 1,
    skipSeen: false,
    tweet: null,
    neighbours: null,
    dashboard: null,
    profile: null,
    shows: null,
    changelog: null,
    publicAction: null,
    metadata: null,
    failure: null,
  })

class RefreshPageFixture extends Command.Service<RefreshPageFixture>()('fixture/RefreshPage', {
  args: {},
  success: Schema.Void,
  invalidates: () => [GetPage],
}) {
  static readonly layer = this.toLayer(() => Effect.void)
}

const FixtureMessage = Schema.TaggedUnion({
  ChangedQuery: { args: PageQueryArgs },
  ClickedRefresh: {},
})

const QueryPage = Html.component({
  name: 'PageQueryFixture',
  props: PageQueryArgs,
  model: PageQueryArgs,
  message: FixtureMessage,
  restore: false,
  queries: { page: { query: GetPage, args: ({ model }) => model } },
}).make({
  init: ($) => $.props,
  update: ($, message) =>
    FixtureMessage.match(message, {
      ChangedQuery: ({ args }) => $.set(args),
      ClickedRefresh: () => $.run(RefreshPageFixture.make({}).pipe(Command.asNoop)),
    }),
  view: (h) =>
    h.p.children(
      AsyncResult.isSuccess(h.queries.page)
        ? (h.queries.page.value.principal?.id ?? 'anonymous')
        : 'Loading',
    ),
})

describe('native page routes', () => {
  it('prefetches only anonymous public documents and refreshes personalized navigation', () => {
    const url = new URL('https://goosebumps.fm/mixes/example')
    expect(canPrefetchPage(url, { known: true, principalId: null })).toBe(true)
    expect(canPrefetchPage(url, { known: true, principalId: 'owner-a' })).toBe(false)
    expect(canPrefetchPage(url, initialPageIdentity)).toBe(false)
    expect(
      pageIdentityForNavigation({ principalId: 'owner-a', known: true, epoch: 2 }, url),
    ).toEqual({ principalId: null, known: false, epoch: 3 })
  })

  it('keeps public paths, repeated queries and unknown query pairs unchanged', () => {
    for (const path of [
      '/',
      '/dashboard/settings/api-keys?q=first&q=second&arbitrary=a+b',
      '/reminders',
      '/mix-upload?edit=a%2Fb',
      '/tweet/new',
      '/tweets?q=archive',
      '/shows/?show=slug&returnTo=%2Flistening',
      '/mixes/a%2Fb?preview=1',
      '/bad/%ZZ',
      '/unrecognised/deep/path',
      '/mixes//a',
    ]) {
      const url = new URL(path, 'https://goosebumps.fm')
      const route = routeFromUrl(url)
      expect(AppRoute.print(route)).toBe(`${url.pathname}${url.search}`)
      expect(pageRoute(route)).toEqual(parseRoute(url.pathname))
      expect(Option.isSome(AppRoute.resolve(path))).toBe(true)
    }
  })

  it('leaves API and action requests outside native page navigation', () => {
    for (const path of [
      '/api/test',
      '/actions/save',
      '/connect/gbfm',
      '/rss.xml',
      'https://example.com/mixes',
      '/auth/verify-email?token=verification-secret',
      '/auth/reset-password?token=reset-secret',
      '/auth/oauth2/authorize?client_id=fixture',
      '/spotify/callback?code=callback-secret&state=fixture',
    ]) {
      expect(Option.isNone(AppRoute.parse(path))).toBe(true)

      expect(
        pageQueryArgs(new URL(path, 'https://goosebumps.fm'), initialPageIdentity, 'fixture') ===
          undefined,
      ).toBe(path.startsWith('/'))
      expect(
        Option.isNone(
          Schema.decodeUnknownOption(PageQueryArgs)({
            path,
            identity: initialPageIdentity,
            realm: 'fixture',
          }),
        ),
      ).toBe(true)
    }
  })

  it('uses native history and guards stale search writes', async () => {
    const held = routeFromUrl(new URL('https://goosebumps.fm/mixes?q=x&custom=y'))

    const result = await runWithLayer(
      Effect.gen(function* () {
        const router = yield* Router.Router
        yield* patchPageSearch(router, held, { q: ['updated'] })
        const updated = router.location().url
        yield* router.navigate('/about')
        const stale = yield* patchPageSearch(router, held, { q: ['stale'] })
        yield* router.back

        return { updated, stale, back: router.location().url }
      }),
      Router.memory({ routes: AppRoute, url: AppRoute.print(held) }),
    )

    expect(result).toEqual({
      updated: '/mixes?custom=y&q=updated',
      stale: 'stale',
      back: '/mixes?custom=y&q=updated',
    })
  })
})

describe('native page query', () => {
  it('rejects an unknown identity from another realm before using the transport', async () => {
    const url = new URL('https://goosebumps.fm/dashboard/favorites')
    let fetches = 0

    const layer = browserPageLayer(url, 'current-realm', async () => {
      fetches += 1

      return Response.json(document('owner'))
    })

    const error = await runWithLayer(
      GetPage.get(queryArgs(url, initialPageIdentity, 'another-realm')).pipe(Effect.flip),
      Layer.merge(layer, Query.layer()),
    )

    expect(error.reason).toBe('identity')
    expect(fetches).toBe(0)
  })

  it('hydrates the actual server query cache without a first client fetch, then invalidates', async () => {
    const page = document('owner-a')

    const args = queryArgs(
      new URL(page.url),
      { principalId: 'owner-a', known: true, epoch: 0 },
      'ssr-request',
    )

    let serverLoads = 0
    const request = new Request(page.url)

    const rendered = await runWithLayer(
      HtmlServer.renderToHtml(QueryPage, args, { budget: '5 seconds' }),
      Layer.merge(
        serverPageLayer({
          request,
          ownedRequest: request,
          requestId: 'ssr-request',
          realm: args.realm,
          preloaded: { path: args.path, document: page },
          load: async () => {
            serverLoads += 1

            return { redirect: '/shows/unexpected-load' }
          },
          prepare: async () => page,
        }),
        RefreshPageFixture.layer,
      ),
    )

    expect(rendered.model).toBeDefined()
    expect(rendered.html).toContain('owner-a')
    expect(serverLoads).toBe(0)

    let clientFetches = 0

    const clientLayer = browserPageLayer(new URL(page.url), args.realm, async () => {
      clientFetches += 1

      return Response.json(page)
    })

    await runWithLayer(
      Effect.gen(function* () {
        const cache = yield* Query.Cache
        Query.internals(cache).hydrate(rendered.state['~query'])
        expect(yield* GetPage.get(args)).toEqual(page)
        expect(clientFetches).toBe(0)
        Query.internals(cache).closeWindow()
        expect(yield* GetPage.get(args)).toEqual(page)
        expect(clientFetches).toBe(0)
        yield* GetPage.invalidate(args)
        expect(yield* GetPage.get(args)).toEqual(page)
        expect(clientFetches).toBe(1)
      }).pipe(Effect.scoped),
      Layer.merge(clientLayer, Query.layer()),
    )
  })

  it('does not reuse a fresh private response after an unobserved account change', async () => {
    const url = new URL('https://goosebumps.fm/dashboard/favorites')
    const initialIdentity = { principalId: 'owner-a', known: true, epoch: 0 }
    const initial = queryArgs(url, initialIdentity, 'browser-realm')
    const next = queryArgs(url, pageIdentityForNavigation(initialIdentity, url), initial.realm)
    const responseB = Promise.withResolvers<Response>()
    let fetches = 0

    const layer = browserPageLayer(url, initial.realm, async () => {
      fetches += 1

      if (fetches === 1) return Response.json(document('owner-a'))

      if (fetches === 2) return responseB.promise

      return Response.json(document('owner-b'))
    })

    expect(canPrefetchPage(url)).toBe(false)
    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(QueryPage, initial)
        yield* TestHost.settle
        expect(root.text()).toBe('owner-a')
        root.send(FixtureMessage.cases.ChangedQuery.make({ args: next }))
        responseB.resolve(Response.json(document('owner-b')))
        yield* TestHost.settle
        expect(root.text()).toBe('owner-b')
        expect(root.frames().slice(2)).not.toContain('owner-a')
        expect(root.entry(GetPage, initial)?.stored._tag).toBe('Success')
        expect(fetches).toBe(2)
        root.send(FixtureMessage.cases.ClickedRefresh.make({}))
        yield* TestHost.settle
        expect(fetches).toBe(3)
        expect(root.text()).toBe('owner-b')
      }).pipe(Effect.scoped),
      Layer.mergeAll(layer, TestHost.layer(), RefreshPageFixture.layer),
    )
  })

  it('loads on the server with request-owned credentials and response policy preparation', async () => {
    const request = new Request('https://goosebumps.fm/dashboard/favorites', {
      headers: { cookie: 'session=fixture', 'x-request-id': 'owned-request' },
    })

    const page = { ...document('owner'), status: 503, failure: 'Unavailable', skipSeen: true }
    const seen: Array<string | null> = []

    const load: ServerPageOptions['load'] = async (owned, original, url, route, requestId) => {
      seen.push(owned.headers.get('cookie'), original.headers.get('cookie'), requestId)

      return {
        redirect: null,
        flags: { ...page, requestId },
        identity: { principal: page.principal, cookies: ['session=renewed; HttpOnly'] },
        response: new Response(null, { headers: { 'set-cookie': 'preference=fixture' } }),
        neighbourResponse: null,
        tweetData: null,
        showDetailSlug: null,
        showMetadata: null,
        profile: null,
        route,
        url,
        requestId,
      }
    }

    const layer = serverPageLayer({
      request,
      ownedRequest: request,
      requestId: 'owned-request',
      realm: 'realm-fixture',
      load,
      prepare: async (loaded) => {
        seen.push(...loaded.identity.cookies, ...(loaded.response?.headers.getSetCookie() ?? []))

        return loaded.flags
      },
    })

    const result = await runWithLayer(
      GetPage.get(queryArgs(new URL(request.url), initialPageIdentity, 'realm-fixture')),
      Layer.merge(layer, Query.layer()),
    )

    expect(seen).toEqual([
      'session=fixture',
      'session=fixture',
      'owned-request',
      'session=renewed; HttpOnly',
      'preference=fixture',
    ])
    expect(result).toEqual({ ...page, requestId: 'owned-request' })
  })

  it('shares concurrent fetches and partitions entries by identity', async () => {
    const requests: Array<{
      url: string
      credentials: RequestCredentials | undefined
      signal: boolean
    }> = []

    const page = document()

    const layer = browserPageLayer(new URL(page.url), 'realm-fixture', async (input, init) => {
      requests.push({
        url: new Request(input).url,
        credentials: init?.credentials,
        signal: init?.signal instanceof AbortSignal,
      })

      return Response.json(page)
    })

    const url = new URL(page.url)

    const result = await runWithLayer(
      Effect.gen(function* () {
        const pair = yield* Effect.all(
          [
            GetPage.get(queryArgs(url, initialPageIdentity, 'realm-fixture')),
            GetPage.get(queryArgs(url, initialPageIdentity, 'realm-fixture')),
          ],
          { concurrency: 'unbounded' },
        )

        yield* GetPage.get(
          queryArgs(url, { principalId: null, known: true, epoch: 1 }, 'realm-fixture'),
        )

        return pair
      }),
      Layer.merge(layer, Query.layer()),
    )

    expect(result).toEqual([page, page])
    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual({
      url: `${page.url}?__data=1`,
      credentials: 'same-origin',
      signal: true,
    })
  })

  it('does not cache another principal response as the requested identity', async () => {
    const page = document('another-user')

    const result = await runWithLayer(
      GetPage.get(
        queryArgs(
          new URL(page.url),
          { principalId: 'current-user', known: true, epoch: 1 },
          'realm-fixture',
        ),
      ).pipe(Effect.flip),
      Layer.merge(
        browserPageLayer(new URL(page.url), 'realm-fixture', async () => Response.json(page)),
        Query.layer(),
      ),
    )

    expect(result.reason).toBe('identity')
  })

  it('preserves readonly DTO fields through JSON decoding', () => {
    const page = document('user')
    expect(Schema.decodeUnknownSync(Schema.toCodecJson(PageDocument))(page)).toEqual(page)
  })

  it('aborts owned browser requests when their query layer closes', async () => {
    const started = Promise.withResolvers<void>()
    let aborted = false
    const url = new URL('https://goosebumps.fm/mixes')

    const layer = browserPageLayer(url, 'realm-fixture', async (_input, init) => {
      started.resolve()

      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new Error('cancelled'))
        })
      })
    })

    await runWithLayer(
      Effect.gen(function* () {
        const pending = yield* Effect.forkScoped(
          GetPage.get(queryArgs(url, initialPageIdentity, 'realm-fixture')),
        )

        yield* Effect.promise(() => started.promise)
        yield* Fiber.interrupt(pending)
      }).pipe(Effect.scoped),
      Layer.merge(layer, Query.layer()),
    )
    expect(aborted).toBe(true)
  })
})
