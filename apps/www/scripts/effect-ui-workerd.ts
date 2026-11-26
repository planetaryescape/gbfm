import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { Miniflare } from 'miniflare'

const fixture = process.argv.includes('--fixture')

const serve = process.argv.includes('--serve')

const root = fileURLToPath(new URL('..', import.meta.url))

const output = resolve(root, fixture ? 'dist-effect-fixture' : 'dist-effect')

const previewPath = process.env.GBFM_EFFECT_PREVIEW_PATH ?? (fixture ? '/' : '/about')

const requestedPort = Number(process.env.GBFM_EFFECT_PREVIEW_PORT ?? '4175')

if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535)
  throw new Error('GBFM_EFFECT_PREVIEW_PORT must be a valid port')

const runtime = new Miniflare({
  host: '127.0.0.1',
  port: serve ? requestedPort : 0,
  workers: [
    {
      name: 'www',
      scriptPath: resolve(output, 'server/fetch.js'),
      modules: true,
      modulesRoot: resolve(output, 'server'),
      modulesRules: [{ type: 'ESModule', include: ['**/*.js'], fallthrough: true }],
      compatibilityDate: '2026-07-04',
      compatibilityFlags: ['nodejs_compat'],
      serviceBindings: { API: 'api', SOCIAL_IMAGES: 'social-images' },
      bindings: {
        APP_STAGE: 'test',
        APP_RELEASE: 'local-effect-ui-fixture',
        EDITORIAL_OAUTH_ISSUER: 'http://127.0.0.1/auth',
        BROWSER_TELEMETRY_ORIGIN: 'http://127.0.0.1',
      },
      assets: {
        directory: resolve(output, 'client'),
        binding: 'ASSETS',
        routerConfig: {
          invoke_user_worker_ahead_of_assets: false,
          has_user_worker: true,
        },
        assetConfig: { not_found_handling: '404-page' },
      },
      outboundService: () =>
        new Response('External network disabled in SSR fixture', { status: 502 }),
    },
    {
      name: 'api',
      modules: true,
      compatibilityDate: '2026-07-04',
      script: `export default {
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === '/api/auth/get-session')
            return Response.json(null)
          if (url.pathname === '/api/content/homepage-mixes')
            return Response.json([])
          return Response.json({ error: 'Unconfigured local fixture endpoint' }, { status: 404 })
        }
      }`,
      outboundService: () => new Response(null, { status: 502 }),
    },
    {
      name: 'social-images',
      modules: true,
      compatibilityDate: '2026-07-04',
      script: `export default { fetch() { return new Response(null, { status: 404 }) } }`,
      outboundService: () => new Response(null, { status: 502 }),
    },
  ],
})

try {
  await runtime.ready
  const fetchPage = runtime.dispatchFetch.bind(runtime)
  const page = await fetchPage(new URL(previewPath, 'http://fixture.test/').href)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /id="root"/)
  assert.match(html, /id="gbfm-ui-state"/)
  assert.match(html, /id="gbfm-ui-props"/)
  assert.match(html, /viewport-fit=cover/)
  const script = html.match(/<script type="module" src="([^"]+)"/)?.[1]
  const stylesheet = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1]
  assert.ok(script, 'The built document must reference its hashed client entry')
  assert.ok(stylesheet, 'The built document must include CSS without JavaScript')

  for (const path of [script, stylesheet]) {
    const asset = await fetchPage(new URL(path, 'http://fixture.test/').href)
    assert.equal(asset.status, 200, `Built asset must resolve: ${path}`)
    assert.doesNotMatch(await asset.text(), /id="gbfm-ui-state"/)
  }

  const missingAsset = await fetchPage('http://fixture.test/assets/not-deployed.js')
  assert.equal(missingAsset.status, 404)
  assert.doesNotMatch(await missingAsset.text(), /id="gbfm-ui-state"/)

  const head = await fetchPage(new URL(previewPath, 'http://fixture.test/').href, {
    method: 'HEAD',
  })

  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.match(head.headers.get('content-type') ?? '', /text\/html/)
  assert.deepEqual(head.headers.getSetCookie(), page.headers.getSetCookie())

  if (fixture) {
    assert.equal(page.headers.getSetCookie().length, 2)
    const identities = ['Alpha', 'Beta']

    const pages = await Promise.all(
      identities.map(async (identity) => {
        const response = await fetchPage('http://fixture.test/identity', {
          headers: { 'x-fixture-identity': identity },
        })

        assert.equal(response.headers.get('x-fixture-query-count'), '1')

        return response.text()
      }),
    )

    assert.match(pages[0] ?? '', /<p>Alpha<\/p>/)
    assert.doesNotMatch(pages[0] ?? '', /Beta/)
    assert.match(pages[1] ?? '', /<p>Beta<\/p>/)
    assert.doesNotMatch(pages[1] ?? '', /Alpha/)
    const redirect = await fetchPage('http://fixture.test/redirect', { redirect: 'manual' })
    assert.equal(redirect.status, 303)
    assert.equal(redirect.headers.get('location'), '/')
    const data = await fetchPage('http://fixture.test/?__data=1')
    assert.deepEqual(await data.json(), { title: 'Native fixture' })
    const missing = await fetchPage('http://fixture.test/missing')
    assert.equal(missing.status, 404)
  }

  process.stdout.write(
    `Effect UI production workerd checks passed (${fixture ? 'isolated fixture' : 'app'})\n`,
  )

  if (serve) {
    process.stdout.write(
      `Local-only Effect UI preview: ${new URL(previewPath, await runtime.ready)}\n`,
    )
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    })
  }
} finally {
  await runtime.dispose()
}
