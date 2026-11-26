import { Head } from '@effect/ui'
import { Html, HtmlServer } from '@effect/ui/html'
import { Effect, Schema } from 'effect'
import { expect, test } from 'vitest'

import { handleRequest } from './host'
import { Rendered, Responded } from './index'
import type { DocumentAssets, EntryResult, ServerEntry } from './types'

const assets: DocumentAssets = {
  entryScript: '/assets/app-test.js',
  stylesheets: ['/assets/app-test.css'],
  modulePreloads: ['/assets/shared-test.js'],
}

const Fixture = Html.component({
  name: 'HostFixture',
  props: Schema.Struct({ title: Schema.String }),
  model: Schema.Struct({ title: Schema.String }),
  message: Schema.Never,
}).make({
  init: ({ props }) => ({ title: props.title }),
  update: ($) => $.model,
  head: ({ model }) => [Head.title(model.title)],
  view: (h, model) => h.h1(model.title),
})

const entry: ServerEntry = {
  async renderPage(request): Promise<EntryResult> {
    const url = new URL(request.url)

    if (url.pathname === '/redirect')
      return Responded(
        new Response(null, {
          status: 303,
          headers: { location: '/target', 'set-cookie': 'redirect=1; HttpOnly' },
        }),
      )

    if (url.searchParams.has('__data'))
      return Responded(Response.json({ title: 'Data fixture' }, { status: 202 }))
    const title = url.searchParams.get('title') ?? 'Native SSR fixture'
    const rendered = await Effect.runPromise(HtmlServer.renderToHtml(Fixture, { title }))

    const headers = new Headers({
      'cache-control': 'private, no-store',
      'x-request-id': request.headers.get('x-request-id') ?? 'fixture-request',
      vary: 'Cookie',
    })

    headers.append('set-cookie', 'first=1; HttpOnly; Path=/')
    headers.append('set-cookie', 'second=2; HttpOnly; Path=/')

    return Rendered(
      {
        ...rendered,
        serializedProps: HtmlServer.serializeState({ title }),
        extraHead: '<meta name="robots" content="noindex, nofollow">',
      },
      {
        status: url.pathname === '/missing' ? 404 : 200,
        headers,
      },
    )
  },
}

test('renders real Effect UI HTML, safely embedded state, assets and request-owned headers', async () => {
  const response = await handleRequest(
    new Request('https://fixture.test/native?title=%3C%2Fscript%3E', {
      headers: { 'x-request-id': 'owned-request' },
    }),
    entry,
    assets,
  )

  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
  expect(response.headers.get('x-request-id')).toBe('owned-request')
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.getSetCookie()).toEqual([
    'first=1; HttpOnly; Path=/',
    'second=2; HttpOnly; Path=/',
  ])
  expect(response.headers.get('vary')).toBe('Cookie, Accept, Sec-Fetch-Dest')
  const html = await response.text()
  expect(html).toContain('<h1>&lt;/script&gt;</h1>')
  expect(html).toContain('id="root"')
  expect(html).toContain('id="gbfm-ui-state"')
  expect(html).toContain('id="gbfm-ui-props">{"title":"\\u003c/script>"}')
  expect(html).toContain('rel="stylesheet" href="/assets/app-test.css"')
  expect(html).toContain('rel="modulepreload" href="/assets/shared-test.js"')
  expect(html).toContain('type="module" src="/assets/app-test.js"')
  expect(html.match(/name="viewport"/g)).toHaveLength(1)
  expect(html).toContain('viewport-fit=cover')
  expect(html).toContain('vite-ui-theme')
  expect(html).toContain('gbfm-audio-queue.json')
})

test('keeps concurrent page heads and hydration props isolated', async () => {
  const pages = await Promise.all(
    ['Alpha', 'Beta'].map(async (title) => {
      const response = await handleRequest(
        new Request(`https://fixture.test/native?title=${title}`),
        entry,
        assets,
      )

      return response.text()
    }),
  )

  expect(pages[0]).toMatch(/<title[^>]*>Alpha<\/title>/)
  expect(pages[0]).not.toContain('Beta')
  expect(pages[1]).toMatch(/<title[^>]*>Beta<\/title>/)
  expect(pages[1]).not.toContain('Alpha')
})

test.each(['/native', '/redirect', '/native?__data=1'])(
  'HEAD preserves GET status, cookies and content type without a body for %s',
  async (path) => {
    const get = await handleRequest(new Request(`https://fixture.test${path}`), entry, assets)

    const head = await handleRequest(
      new Request(`https://fixture.test${path}`, { method: 'HEAD' }),
      entry,
      assets,
    )

    expect(head.status).toBe(get.status)
    expect(head.headers.getSetCookie()).toEqual(get.headers.getSetCookie())
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'))
    expect(await head.text()).toBe('')
    await get.body?.cancel()
  },
)

test('preserves redirect and data responses instead of rendering documents', async () => {
  const redirect = await handleRequest(new Request('https://fixture.test/redirect'), entry, assets)
  expect(redirect.status).toBe(303)
  expect(redirect.headers.get('location')).toBe('/target')

  const data = await handleRequest(
    new Request('https://fixture.test/native?__data=1'),
    entry,
    assets,
  )

  expect(data.status).toBe(202)
  expect(await data.json()).toEqual({ title: 'Data fixture' })
  const missing = await handleRequest(new Request('https://fixture.test/missing'), entry, assets)
  expect(missing.status).toBe(404)
  expect(await missing.text()).toContain('noindex, nofollow')
})

test.each([
  ['/assets/stale.js', '*/*', '', null],
  ['/assets/stale%2Ejs', 'text/html', '', null],
  ['/native', '*/*', 'script', 'Sec-Fetch-Dest'],
  ['/native', 'text/html;q=0, */*;q=1', '', 'Accept, Sec-Fetch-Dest'],
])(
  'refuses a static miss without calling the app: %s %s %s',
  async (path, accept, destination, vary) => {
    const refusingEntry: ServerEntry = {
      async renderPage() {
        throw new Error('A static miss must not reach the application')
      },
    }

    const response = await handleRequest(
      new Request(`https://fixture.test${path}`, {
        headers: { accept, 'sec-fetch-dest': destination },
      }),
      refusingEntry,
      assets,
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('vary')).toBe(vary)
    expect(await response.text()).toBe('')
  },
)

test('passes OPTIONS and streaming POST bodies to the application', async () => {
  const echo: ServerEntry = {
    async renderPage(request) {
      return Responded(
        new Response(request.body, {
          status: request.method === 'OPTIONS' ? 204 : 201,
          headers: { 'access-control-allow-origin': 'https://fixture.test' },
        }),
      )
    },
  }

  const options = await handleRequest(
    new Request('https://fixture.test/actions/native', { method: 'OPTIONS' }),
    echo,
    assets,
  )

  expect(options.status).toBe(204)

  const posted = await handleRequest(
    new Request('https://fixture.test/actions/native', { method: 'POST', body: 'streamed form' }),
    echo,
    assets,
  )

  expect(posted.status).toBe(201)
  expect(await posted.text()).toBe('streamed form')
})
