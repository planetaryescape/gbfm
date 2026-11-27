import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { Miniflare } from 'miniflare'

import { createFixtureApiBinding, parseFixtureBase } from './effect-ui-fixture-api'

const fixture = process.argv.includes('--fixture')

const serve = process.argv.includes('--serve')

const root = fileURLToPath(new URL('..', import.meta.url))

const output = resolve(root, fixture ? 'dist-effect-fixture' : 'dist-effect')

const previewPath = process.env.GBFM_EFFECT_PREVIEW_PATH ?? (fixture ? '/' : '/about')

const requestedPort = Number(process.env.GBFM_EFFECT_PREVIEW_PORT ?? '4175')

const fixtureBase = parseFixtureBase(process.env.GBFM_FRONTEND_FIXTURE_BASE)

const fixtureTurnstileSiteKey = '1x00000000000000000000AA'

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
      serviceBindings: {
        API: createFixtureApiBinding(fixtureBase?.origin),
        SOCIAL_IMAGES: 'social-images',
      },
      bindings: {
        APP_STAGE: 'test',
        APP_RELEASE: 'local-effect-ui-fixture',
        EDITORIAL_OAUTH_ISSUER: new URL('/auth', fixtureBase ?? 'http://127.0.0.1').href,
        BROWSER_TELEMETRY_ORIGIN: 'http://127.0.0.1',
        TURNSTILE_SITE_KEY: fixtureBase ? fixtureTurnstileSiteKey : '',
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
    assert.match(html, /Worker markdown blocks: 1/)
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
  } else {
    for (const path of [
      '/spotify/callback',
      '/dashboard/spotify-callback',
      '/dashboard/%73potify-callback',
    ]) {
      for (const data of [false, true]) {
        const callback = new URL(path, 'http://fixture.test')
        callback.searchParams.set('code', 'synthetic-code-never-serialized')
        callback.searchParams.set('state', 'synthetic-state-never-serialized')

        if (data) callback.searchParams.set('__data', '1')
        const response = await fetchPage(callback.href)
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('location'), null)
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
        assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/)
        assert.match(response.headers.get('content-type') ?? '', /text\/html/)
        const document = await response.text()
        assert.match(document, /"kind":"spotify-callback"/)
        assert.doesNotMatch(document, /synthetic-code-never-serialized/)
        assert.doesNotMatch(document, /synthetic-state-never-serialized/)
      }
    }

    if (fixtureBase) {
      for (const path of ['/auth/sign-up', '/subscribe']) {
        const response = await fetchPage(new URL(path, 'http://fixture.test').href)
        assert.equal(response.status, 200)
        const document = await response.text()
        assert.ok(
          document.includes(fixtureTurnstileSiteKey),
          `Local ${path} must receive the public Turnstile test site key`,
        )
        assert.match(document, /data-turnstile/)
        assert.doesNotMatch(document, /Verification is unavailable/)
      }
    }
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
