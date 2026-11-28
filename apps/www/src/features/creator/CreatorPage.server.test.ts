import { HtmlServer } from '@effect/ui/html'
import { assert, describe, it } from '@effect/vitest'
import { Context, Effect, Layer, Schema } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'

import { CreatorPage } from './CreatorPage'
import { handleCreatorFormAction, type CreatorApiRequest } from './server'
import { CreatorService, CreatorServiceLive } from './services'

const principal = { id: 'author-a', name: 'Author', username: 'author', role: 'admin' }

const request = (fields: Readonly<Record<string, string>>, origin = 'https://gbfm.test') =>
  new Request('https://gbfm.test/actions/creator/save', {
    method: 'POST',
    headers: { origin },
    body: new URLSearchParams(fields),
  })

describe('native creator server boundaries', () => {
  it.effect('isolates concurrent private edit renders through request-owned Fetch references', () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly requestId: string; readonly method: string }> = []

      const api: CreatorApiRequest = async (ownedRequest, path, init) => {
        const requestId = ownedRequest.headers.get('x-request-id') ?? ''

        calls.push({ requestId, method: init?.method ?? 'GET' })
        assert.isTrue(ownedRequest.headers.get('cookie') === `session=${requestId}-fixture`)
        assert.equal(path, '/api/content/posts/private-essay/edit')

        await Promise.resolve()

        return Response.json(
          {
            id: `post-${requestId}`,
            slug: 'private-essay',
            updatedAt: '2026-11-26T12:00:00.000Z',
            type: 'post',
            draft: true,
            title: `Private editorial ${requestId}`,
            content: `Private body ${requestId}`,
            description: null,
            thumbnailUrl: null,
            tags: [],
            creators: [{ id: requestId, name: requestId, username: requestId }],
            musicEntityType: null,
            musicEntityId: null,
            quotedPostId: null,
          },
          { headers: { 'set-cookie': `session=not-for-page-state-${requestId}` } },
        )
      }

      const results = yield* Effect.forEach(
        ['A', 'B'],
        (id) =>
          Effect.gen(function* () {
            const ownedRequest = new Request('https://gbfm.test/new/editorial?edit=private-essay', {
              headers: { cookie: `session=${id}-fixture`, 'x-request-id': id },
            })

            const boundFetch: typeof globalThis.fetch = (input, init) => {
              const target = new URL(
                input instanceof Request ? input.url : input.toString(),
                ownedRequest.url,
              )

              return api(ownedRequest, `${target.pathname}${target.search}`, init)
            }

            const transport = Layer.succeed(FetchHttpClient.Fetch, boundFetch)

            const context = yield* Layer.build(
              Layer.mergeAll(
                transport,
                FetchHttpClient.layer.pipe(Layer.provide(transport)),
                CreatorServiceLive.pipe(Layer.provide(transport)),
              ),
            )

            const client = Context.get(context, HttpClient.HttpClient).pipe(
              HttpClient.mapRequest(HttpClientRequest.prependUrl(new URL(ownedRequest.url).origin)),
            )

            const renderContext = Context.add(context, HttpClient.HttpClient, client)

            const rendered = yield* HtmlServer.renderToHtml(CreatorPage, {
              url: ownedRequest.url,
              principal: { id, name: id, username: id, role: 'admin' },
            }).pipe(Effect.provide(renderContext))

            const creator = Context.get(context, CreatorService)
            const editable = yield* creator.loadEditable('post', 'private-essay')

            assert.equal(editable.title, `Private editorial ${id}`)

            return { id, rendered }
          }),
        { concurrency: 2 },
      )

      for (const { id, rendered } of results) {
        const other = id === 'A' ? 'B' : 'A'
        const state = HtmlServer.serializeState(rendered.state)

        assert.isTrue(rendered.html.includes(`Private editorial ${id}`))
        assert.isTrue(rendered.html.includes(`Private body ${id}`))
        assert.isFalse(rendered.html.includes(`Private body ${other}`))
        assert.isFalse(state.includes(`Private body ${other}`))
        assert.isFalse(state.includes('not-for-page-state'))
        assert.isFalse(state.includes('session='))
      }

      assert.lengthOf(calls, 4)
      assert.equal(calls.filter(({ requestId }) => requestId === 'A').length, 2)
      assert.equal(calls.filter(({ requestId }) => requestId === 'B').length, 2)
      assert.isTrue(calls.every(({ method }) => method === 'GET'))
    }),
  )

  it.effect('renders a readable editable draft through the request-owned native HttpClient', () =>
    Effect.gen(function* () {
      const paths: Array<string> = []

      const client = HttpClient.make((incoming, url) =>
        Effect.sync(() => {
          paths.push(url.pathname)

          return HttpClientResponse.fromWeb(
            incoming,
            Response.json(
              {
                id: 'post-a',
                slug: 'private-essay',
                updatedAt: '2026-11-26T12:00:00.000Z',
                type: 'post',
                draft: true,
                title: 'A private editorial',
                content: 'Readable SSR draft body',
                description: 'Not public',
                thumbnailUrl: null,
                tags: [],
                creators: [principal],
                musicEntityType: null,
                musicEntityId: null,
                quotedPostId: null,
              },
              { headers: { 'set-cookie': 'session=private-http-only-fixture' } },
            ),
          )
        }),
      ).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl('https://gbfm.test')))

      const context = yield* Layer.build(Layer.succeed(HttpClient.HttpClient, client))

      const rendered = yield* HtmlServer.renderToHtml(CreatorPage, {
        url: 'https://gbfm.test/new/editorial?edit=private-essay',
        principal,
      }).pipe(Effect.provide(context))

      assert.include(rendered.html, 'A private editorial')
      assert.include(rendered.html, 'Readable SSR draft body')
      assert.include(rendered.html, '/actions/creator/save')
      assert.deepEqual(paths, ['/api/content/posts/private-essay/edit'])
      assert.isFalse(rendered.html.includes('Forbidden'))
      assert.notInclude(HtmlServer.serializeState(rendered.state), 'private-http-only-fixture')
      assert.notInclude(HtmlServer.serializeState(rendered.state), 'uploadUrl')
    }),
  )

  it('saves private content through the native form seam and forwards its revision', async () => {
    const writes: Array<{ path: string; body: unknown; method: string | undefined }> = []

    const api: CreatorApiRequest = async (_request, path, init) => {
      writes.push({
        path,
        body: JSON.parse(Schema.decodeUnknownSync(Schema.String)(init?.body)),
        method: init?.method,
      })

      return Response.json({ slug: 'saved-editorial' })
    }

    const result = await handleCreatorFormAction(
      request({
        kind: 'post',
        editSlug: 'saved-editorial',
        title: 'Edited title',
        content: 'Retain this text',
        expectedUpdatedAt: '2026-11-26T12:00:00.000Z',
        intent: 'draft',
      }),
      principal,
      api,
    )

    assert.equal(result.status, 303)
    assert.equal(result.headers.get('cache-control'), 'private, no-store')
    assert.deepInclude(writes[0], {
      path: '/api/content/posts/saved-editorial',
      method: 'PATCH',
    })
    assert.deepInclude(writes[0]?.body, {
      expectedUpdatedAt: '2026-11-26T12:00:00.000Z',
      draft: true,
      content: 'Retain this text',
    })
  })

  it('refuses cross-origin, unauthorized, unreviewed and revisionless writes before the API seam', async () => {
    const writes: Array<string> = []

    const api: CreatorApiRequest = async (_request, path) => {
      writes.push(path)

      return Response.json({ slug: 'unexpected' })
    }

    const fields = { kind: 'post', title: 'Draft', content: 'Private text' }

    assert.equal(
      (await handleCreatorFormAction(request(fields, 'https://evil.test'), principal, api)).status,
      403,
    )
    assert.equal((await handleCreatorFormAction(request(fields), null, api)).status, 403)
    assert.equal(
      (await handleCreatorFormAction(request({ ...fields, intent: 'publish' }), principal, api))
        .status,
      422,
    )
    assert.equal(
      (await handleCreatorFormAction(request({ ...fields, editSlug: 'existing' }), principal, api))
        .status,
      409,
    )
    assert.lengthOf(writes, 0)
  })

  it('forwards an explicit reviewed publish and preserves a conflict instead of overwriting it', async () => {
    const payloads: Array<unknown> = []

    const api: CreatorApiRequest = async (_request, _path, init) => {
      payloads.push(JSON.parse(Schema.decodeUnknownSync(Schema.String)(init?.body)))

      return new Response(null, { status: 409 })
    }

    const response = await handleCreatorFormAction(
      request({
        kind: 'micro',
        title: 'Ready to publish',
        intent: 'publish',
        confirmPublish: 'yes',
      }),
      principal,
      api,
    )

    assert.equal(response.status, 409)
    assert.deepInclude(payloads[0], { draft: false })
    assert.include(await response.text(), 'changed elsewhere')
  })
})
