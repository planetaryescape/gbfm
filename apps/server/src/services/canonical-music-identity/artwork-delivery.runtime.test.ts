import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Schema } from 'effect'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, expect, test } from 'vitest'

let runtime: Miniflare

let directory: string

const requests: Array<string | undefined> = []

const origin = createServer((request, response) => {
  requests.push(request.url)

  if (request.url?.startsWith('/redirect/')) {
    response.writeHead(Number(request.url.split('/')[2]), {
      location: 'https://i.scdn.co/cover',
      'content-type': 'image/jpeg',
    })
    response.end(new Uint8Array([1, 2, 3]))

    return
  }

  response.writeHead(request.url === '/unavailable' ? 503 : 200, { 'content-type': 'image/jpeg' })
  response.end(new Uint8Array([1, 2, 3]))
})

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gbfm-import-artwork-'))
  const scriptPath = join(directory, 'worker.mjs')
  execFileSync('bun', [
    'build',
    'src/test/music-import-artwork-worker.ts',
    '--target=browser',
    '--outfile',
    scriptPath,
  ])
  await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve))
  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(origin.address())
  runtime = new Miniflare({
    scriptPath,
    modulesRoot: directory,
    modules: true,
    compatibilityDate: '2026-07-04',
    compatibilityFlags: ['nodejs_compat'],
    outboundService: { external: { address: `127.0.0.1:${address.port}`, http: {} } },
  })
})

afterAll(async () => {
  await runtime?.dispose()
  await new Promise<void>((resolve, reject) =>
    origin.close((error) => (error ? reject(error) : resolve())),
  )

  if (directory) await rm(directory, { recursive: true, force: true })
})

test('the default fetch reference delivers bytes using native workerd fetch and its abort signal', async () => {
  const before = requests.length
  const response = await runtime.dispatchFetch('https://worker.example.test/cover')
  expect(await response.json()).toEqual({
    status: 'fetched',
    contentType: 'image/jpeg',
    byteLength: 3,
  })
  expect(requests.slice(before)).toEqual(['/cover'])
})

test.each([301, 302, 303, 307, 308])(
  'native fetch rejects %i without following even an approved redirect',
  async (status) => {
    const before = requests.length
    const response = await runtime.dispatchFetch(`https://worker.example.test/redirect/${status}`)
    expect(await response.json()).toEqual({ status: 'rejected' })
    expect(requests.slice(before)).toEqual([`/redirect/${status}`])
  },
)

test('native provider errors retain the recoverable classification', async () => {
  const response = await runtime.dispatchFetch('https://worker.example.test/unavailable')
  expect(await response.json()).toEqual({ status: 'unavailable', reason: 'provider_status' })
})
