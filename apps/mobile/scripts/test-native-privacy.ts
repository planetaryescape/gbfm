import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'

import { Option, Schema } from 'effect'

const execute = promisify(execFile)
const event = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      platform: Schema.Literal('cocoa'),
      release: Schema.String,
      user: Schema.optional(Schema.Unknown),
      request: Schema.optional(Schema.Unknown),
      extra: Schema.optional(Schema.Unknown),
      contexts: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      exception: Schema.Struct({
        values: Schema.Array(
          Schema.Struct({
            value: Schema.String,
          }),
        ),
      }),
      debug_meta: Schema.optional(
        Schema.Struct({
          images: Schema.Array(
            Schema.Struct({
              debug_id: Schema.String,
            }),
          ),
        }),
      ),
    }),
  ),
)
const directory = await mkdtemp(join(tmpdir(), 'gbfm-native-privacy-'))
const framework =
  process.env.SENTRY_COCOA_FRAMEWORK ??
  join(
    homedir(),
    'Library/Caches/sentry-react-native/xcframeworks/9.32.0/Sentry.xcframework/macos-arm64_arm64e_x86_64',
  )
const envelopes: Array<string> = []
const requests: Array<Promise<void>> = []
const collect = async (request: IncomingMessage, response: ServerResponse) => {
  const chunks: Array<Buffer> = []
  let size = 0
  for await (const chunk of request) {
    const data = Schema.decodeUnknownSync(Schema.instanceOf(Buffer))(chunk)
    size += data.length
    if (size > 1024 * 1024) {
      response.writeHead(413).end()
      return
    }
    chunks.push(data)
  }
  const body = Buffer.concat(chunks)
  const decoded = request.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body
  envelopes.push(decoded.toString('utf8'))
  response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
}
const server = createServer((request, response) => {
  requests.push(
    collect(request, response).catch(() => {
      response.destroy()
    }),
  )
})
try {
  await execute(
    'xcrun',
    [
      'swiftc',
      '-g',
      '-F',
      framework,
      '-framework',
      'Sentry',
      '-Xlinker',
      '-rpath',
      '-Xlinker',
      framework,
      resolve('native/GBFMSentryPrivacy.swift'),
      resolve('native-tests/Privacy.swift'),
      '-o',
      join(directory, 'verify-privacy'),
    ],
    { timeout: 60_000 },
  )
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address())
  await execute(join(directory, 'verify-privacy'), [], {
    timeout: 30_000,
    env: { ...process.env, GBFM_NATIVE_CAPTURE_DSN: `http://abc123@127.0.0.1:${address.port}/1` },
  })
  const payload = envelopes.join('\n')
  assert(!payload.includes('synthetic-native-secret-do-not-export'))
  const events = envelopes.flatMap((body) =>
    body.split('\n').flatMap((line) => Option.toArray(event(line))),
  )
  assert(
    events.length >= 2,
    'Native event and nonfatal exception must both reach the real SDK transport',
  )
  assert(events.every((entry) => entry.release === `gbfm-mobile@${'a'.repeat(40)}`))
  assert(
    events.every(
      (entry) =>
        entry.user === undefined && entry.request === undefined && entry.extra === undefined,
    ),
  )
  assert(
    events.every((entry) =>
      Object.keys(entry.contexts ?? {}).every((key) => ['trace', 'os', 'device'].includes(key)),
    ),
  )
  assert(events.some((entry) => (entry.debug_meta?.images.length ?? 0) > 0))
  assert(
    events.every((entry) =>
      entry.exception.values.every(
        (exception) => exception.value === 'Unexpected native application error',
      ),
    ),
  )
  console.log(
    JSON.stringify({
      nativeEvents: events.length,
      syntheticSecretAbsent: true,
      symbolicationMetadataRetained: true,
      transport: 'local Cocoa SDK envelopes',
    }),
  )
} finally {
  await Promise.allSettled(requests)
  if (server.listening) {
    server.close()
    await once(server, 'close')
  }
  await rm(directory, { recursive: true, force: true })
}
