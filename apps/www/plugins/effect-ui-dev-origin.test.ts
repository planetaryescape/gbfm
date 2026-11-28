import { request } from 'node:http'
import { fileURLToPath } from 'node:url'

import { Predicate } from 'effect'
import { createServer, type Plugin, type ViteDevServer } from 'vite'
import { expect, test } from 'vitest'

import { effectUi } from './effect-ui'

const entryId = 'virtual:gbfm-dev-origin-fixture'

const fixtureEntry = (): Plugin => ({
  name: 'gbfm:dev-origin-fixture',
  resolveId(id) {
    return id === entryId ? `\0${entryId}` : undefined
  },
  load(id) {
    if (id !== `\0${entryId}`) return undefined

    return `
export const handlesHttpRequest = () => true
export const renderPage = async (request) => ({
  _tag: 'Responded',
  response: new Response(JSON.stringify({ url: request.url }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  }),
})
`
  },
})

const withDevServer = async (
  options: { readonly origin?: string; readonly portlessUrl?: string },
  check: (port: number) => Promise<void>,
) => {
  const previousPortlessUrl = process.env.PORTLESS_URL

  if (options.portlessUrl === undefined) delete process.env.PORTLESS_URL
  else process.env.PORTLESS_URL = options.portlessUrl

  let server: ViteDevServer | undefined

  try {
    server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)),
      configFile: false,
      plugins: [
        fixtureEntry(),
        effectUi({
          serverEntry: entryId,
          clientEntry: '/unused-origin-fixture-client.ts',
          origin: options.origin,
        }),
      ],
      server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
      logLevel: 'error',
    })
    await server.listen()
    const address = server.httpServer?.address()

    if (!address || Predicate.isString(address)) throw new Error('Missing fixture listener')
    await check(address.port)
  } finally {
    await server?.close()

    if (previousPortlessUrl === undefined) delete process.env.PORTLESS_URL
    else process.env.PORTLESS_URL = previousPortlessUrl
  }
}

const readEntryUrl = (
  port: number,
  host: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<{ readonly status: number; readonly body: string }> =>
  new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/about?fixture=origin',
        headers: { ...headers, host },
      },
      (incoming) => {
        let body = ''
        incoming.setEncoding('utf8')
        incoming.on('data', (chunk: string) => {
          body += chunk
        })
        incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body }))
        incoming.on('error', reject)
      },
    )

    outgoing.setTimeout(10_000, () => outgoing.destroy(new Error('Fixture request timed out')))
    outgoing.on('error', reject)
    outgoing.end()
  })

test('an explicit dev origin remains authoritative over Host and forwarded headers', async () => {
  await withDevServer({ origin: 'http://configured.localhost:1355' }, async (port) => {
    const response = await readEntryUrl(port, `localhost:${port}`, {
      'x-forwarded-host': 'untrusted.example',
      'x-forwarded-proto': 'https',
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      url: 'http://configured.localhost:1355/about?fixture=origin',
    })
  })
}, 30_000)

test('a direct loopback alias retains the browser authority in the entry URL used for bootstrap', async () => {
  await withDevServer({}, async (port) => {
    const response = await readEntryUrl(port, `localhost:${port}`)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      url: `http://localhost:${port}/about?fixture=origin`,
    })
  })
}, 30_000)

test('the official Portless public URL supplies the browser origin instead of its internal Vite port', async () => {
  await withDevServer({ portlessUrl: 'http://gbfm.localhost:1355' }, async (port) => {
    const response = await readEntryUrl(port, 'gbfm.localhost:1355')
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      url: 'http://gbfm.localhost:1355/about?fixture=origin',
    })
  })
}, 30_000)

test('an arbitrary IP Host or forwarded authority cannot become the entry origin', async () => {
  await withDevServer({}, async (port) => {
    const response = await readEntryUrl(port, '198.51.100.1:4321', {
      'x-forwarded-host': 'untrusted.example',
      'x-forwarded-proto': 'https',
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      url: `http://127.0.0.1:${port}/about?fixture=origin`,
    })
  })
}, 30_000)

test('a loopback Host cannot redirect server-side requests to another listener port', async () => {
  await withDevServer({}, async (port) => {
    const otherPort = port === 4321 ? 4322 : 4321
    const response = await readEntryUrl(port, `localhost:${otherPort}`)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      url: `http://127.0.0.1:${port}/about?fixture=origin`,
    })
  })
}, 30_000)

test.each([
  'http://gbfm.localhost.untrusted.example:1355',
  'http://fixture:credential@gbfm.localhost:1355',
  'http://gbfm.localhost:1355/not-an-origin?fixture=1#fragment',
])(
  'invalid Portless authority %s cannot become the entry origin',
  async (portlessUrl) => {
    await withDevServer({ portlessUrl }, async (port) => {
      const response = await readEntryUrl(port, `127.0.0.1:${port}`)
      expect(response.status).toBe(200)
      expect(JSON.parse(response.body)).toEqual({
        url: `http://127.0.0.1:${port}/about?fixture=origin`,
      })
    })
  },
  30_000,
)
