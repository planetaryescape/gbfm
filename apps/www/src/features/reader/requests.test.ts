import { Query } from '@effect/ui'
import { HtmlServer } from '@effect/ui/html'
import { assert, it } from '@effect/vitest'
import { MicroPostScreenResponse } from '@gbfm/api/post'
import { Context, Effect, Layer } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'

import { SpotifyConnection } from '../../spotify/connection'
import { RecordVisit } from './commands'
import { ReaderSsrApplication } from './composition.test-support'
import { ReaderPageMessage } from './contracts'
import { neighbours, props, screen } from './fixtures.test-support'
import { ReaderNeighbours, ReaderReplies } from './requests'

const token = { identity: 'anonymous', generation: 0, slug: 'with space', navigationId: 1 }

type RequestRecord = { readonly method: string; readonly path: string }

class ReaderHttpFixture extends Context.Service<
  ReaderHttpFixture,
  {
    readonly requests: Array<RequestRecord>
    readonly respond: (response: (url: URL) => Response) => void
  }
>()('reader/test/ReaderHttpFixture') {}

const httpLayer = Layer.unwrap(
  Effect.sync(() => {
    const requests: Array<RequestRecord> = []
    let respond = (_url: URL) => new Response(null, { status: 503 })

    const client = HttpClient.make((request, url) =>
      Effect.sync(() => {
        requests.push({ method: request.method, path: url.pathname })

        return HttpClientResponse.fromWeb(request, respond(url))
      }),
    ).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl('https://goosebumps.fm')))

    return Layer.mergeAll(
      Layer.succeed(HttpClient.HttpClient, client),
      Layer.succeed(ReaderHttpFixture, {
        requests,
        respond: (response) => {
          respond = response
        },
      }),
    )
  }),
)

const testLayer = Layer.mergeAll(
  RecordVisit.layer,
  ReaderNeighbours.layer,
  ReaderReplies.layer,
  Query.layer(),
  Layer.succeed(SpotifyConnection, {
    status: Effect.die('SSR must not read browser Spotify status'),
    playback: () => Effect.die('SSR must not start Spotify playback'),
    connect: Effect.die('SSR must not connect Spotify'),
    disconnect: Effect.die('SSR must not disconnect Spotify'),
    completeCallback: Effect.die('SSR must not complete a Spotify callback'),
  }),
).pipe(Layer.provideMerge(httpLayer))

it.layer(testLayer, { buildPerTest: true })('reader HTTP boundary', (it) => {
  it.effect(
    'writes the exact slug and parses the recorded result rather than assuming success',
    () =>
      Effect.gen(function* () {
        const http = yield* ReaderHttpFixture
        http.respond(() => Response.json({ recorded: false }))
        const result = yield* RecordVisit.make(token).effect
        assert.deepStrictEqual(result, ReaderPageMessage.FailedRecordVisit(token))
        assert.deepStrictEqual(http.requests, [
          {
            method: 'POST',
            path: '/api/content/posts/micro/with%20space/seen',
          },
        ])
      }),
  )

  it.effect('turns malformed seen payloads into a retryable visit failure', () =>
    Effect.gen(function* () {
      const http = yield* ReaderHttpFixture
      http.respond(() => Response.json({ recorded: 'yes' }))
      const result = yield* RecordVisit.make(token).effect
      assert.deepStrictEqual(result, ReaderPageMessage.FailedRecordVisit(token))
    }),
  )

  it.effect(
    'loads typed navigation and replies at their established endpoints with the originating token',
    () =>
      Effect.gen(function* () {
        const http = yield* ReaderHttpFixture
        http.respond((url) => Response.json(url.pathname.endsWith('/neighbours') ? neighbours : []))
        const args = { ...token, revision: 2, refresh: 0 }

        const result = yield* Effect.all({
          navigation: ReaderNeighbours.get(args),
          replies: ReaderReplies.get(token),
        })

        assert.deepStrictEqual(result.navigation, { ...args, neighbours })
        assert.deepStrictEqual(result.replies, [])
        assert.deepStrictEqual(http.requests, [
          { method: 'GET', path: '/api/content/posts/micro/with%20space/neighbours' },
          { method: 'GET', path: '/api/content/posts/micro/with%20space/screen/replies' },
        ])
      }),
  )

  it.effect(
    'server-renders readable writing, chronological links and reply fallback without recording visits',
    () =>
      Effect.gen(function* () {
        const http = yield* ReaderHttpFixture
        const rendered = yield* HtmlServer.renderToHtml(ReaderSsrApplication, props())
        assert.include(rendered.html, 'Tweet b')
        assert.include(rendered.html, '<strong>writing</strong>')
        assert.include(rendered.html, 'href="/tweet/a"')
        assert.include(rendered.html, 'to reply')
        assert.deepStrictEqual(http.requests, [])
      }),
  )

  it.effect(
    'keeps native reply and author-edit forms readable and escapes untrusted writing in drafts',
    () =>
      Effect.gen(function* () {
        const draft = screen('draft')

        const document = MicroPostScreenResponse.make({
          ...draft,
          post: { ...draft.post, draft: true, content: '<script>unsafe()</script>' },
        })

        const rendered = yield* HtmlServer.renderToHtml(ReaderSsrApplication, {
          ...props('draft'),
          principal: { id: 'author', name: 'Author', username: 'author', role: null },
          screen: document,
        })

        assert.include(rendered.html, 'only visible to authorised readers')
        assert.include(rendered.html, '&lt;script&gt;')
        assert.notInclude(rendered.html, '<script>unsafe()')
        assert.include(rendered.html, 'action="/actions/reply?slug=draft"')
        assert.include(rendered.html, 'name="content"')
        assert.include(rendered.html, '/new/tweet?edit=draft')
      }),
  )

  it.effect(
    'renders native music and outbound Spotify fallback without starting a browser-only connection during SSR',
    () =>
      Effect.gen(function* () {
        const original = screen('music')

        const document = MicroPostScreenResponse.make({
          ...original,
          post: {
            ...original.post,
            music: {
              entity: {
                id: 'record',
                type: 'album',
                title: 'The record',
                artistNames: ['Artist'],
                coverImageUrl: null,
              },
              links: [{ platform: 'spotify', url: 'https://open.spotify.com/album/record' }],
            },
          },
        })

        const http = yield* ReaderHttpFixture

        const rendered = yield* HtmlServer.renderToHtml(ReaderSsrApplication, {
          ...props('music'),
          screen: document,
        })

        assert.include(rendered.html, 'The record')
        assert.include(rendered.html, 'spotify')
        assert.include(rendered.html, 'href="https://open.spotify.com/album/record"')
        assert.notInclude(rendered.html, '<iframe')
        assert.deepStrictEqual(http.requests, [])
      }),
  )
})
