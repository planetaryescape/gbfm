import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { Schema } from 'effect'

const execute = promisify(execFile)
const archive = Schema.decodeUnknownSync(Schema.NonEmptyString)(process.argv[2])
const sourceMapPath = Schema.decodeUnknownSync(Schema.NonEmptyString)(process.argv[3])
const sha = Schema.decodeUnknownSync(Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)))(
  process.env.GBFM_BUILD_SHA,
)
assert((await execute('git', ['rev-parse', 'HEAD'])).stdout.trim() === sha)
const release = `gbfm-mobile@${sha}`
const app = join(resolve(archive), 'Products/Applications/gbfm.app')
const plist = async (name: string) =>
  (
    await execute('plutil', ['-extract', name, 'raw', '-o', '-', join(app, 'Info.plist')])
  ).stdout.trim()
const executable = await plist('CFBundleExecutable')
assert(executable === 'gbfm')
assert((await plist('GBFMSentryRelease')) === release)
assert((await plist('GBFMSentryEnabled')) === 'true')
const binary = join(app, executable)
const dsym = join(resolve(archive), 'dSYMs/gbfm.app.dSYM/Contents/Resources/DWARF', executable)
const identifiers = async (path: string) => {
  const output = (await execute('xcrun', ['dwarfdump', '--uuid', path])).stdout
  return [...output.matchAll(/UUID: ([A-Fa-f0-9-]{36}) \(([^)]+)\)/g)].map((match) => ({
    uuid: match[1]?.toLowerCase(),
    architecture: match[2],
  }))
}
const uuids = await identifiers(binary)
assert(uuids.length > 0)
assert.deepEqual(uuids, await identifiers(dsym))
const sourceMapBytes = await readFile(sourceMapPath)
const sourceMapText = sourceMapBytes.toString('utf8')
const sourceMap = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.Literal(3),
      debug_id: Schema.optional(Schema.String),
      debugId: Schema.optional(Schema.String),
      sources: Schema.Array(Schema.String),
    }),
  ),
)(sourceMapText)
const debugId = Schema.decodeUnknownSync(
  Schema.String.check(
    Schema.isPattern(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),
  ),
)(sourceMap.debug_id ?? sourceMap.debugId)
const bundle = await readFile(join(app, 'main.jsbundle'))
assert(
  bundle.includes(Buffer.from(release)),
  'JavaScript and native configuration must carry the same release',
)
assert(
  bundle.includes(Buffer.from(debugId)),
  'Hermes bundle and source map must carry the same debug ID',
)
assert(sourceMap.sources.some((source) => source.includes('src/observability/sentry')))
const upload = process.env.GBFM_SENTRY_UPLOAD === 'true'
const requireNative = createRequire(import.meta.resolve('@sentry/react-native/package.json'))
const cli = join(dirname(requireNative.resolve('@sentry/cli/package.json')), 'bin/sentry-cli')
if (upload) {
  const token = Schema.decodeUnknownSync(Schema.NonEmptyString)(process.env.SENTRY_AUTH_TOKEN)
  assert(
    !sourceMapText.includes(token) && !bundle.includes(Buffer.from(token)),
    'Build credentials must not appear in JavaScript artifacts',
  )
  await execute(
    process.execPath,
    [cli, 'debug-files', 'upload', '--wait', '--type', 'dsym', join(resolve(archive), 'dSYMs')],
    { timeout: 300_000, maxBuffer: 1024 * 1024 },
  )
}
const provenance = {
  source: sha,
  release,
  dist: await plist('CFBundleVersion'),
  nativeImages: uuids,
  javascriptDebugId: debugId,
  bundleSha256: createHash('sha256').update(bundle).digest('hex'),
  sourceMapSha256: createHash('sha256').update(sourceMapBytes).digest('hex'),
  nativeUploadProcessed: upload,
  retainedSymbolicationVerified: false,
  signing: 'unsigned device archive, sign without rebuilding',
}
await writeFile(
  join(dirname(resolve(archive)), 'gbfm-ios-provenance.json'),
  JSON.stringify(provenance, null, 2),
)
console.log(JSON.stringify(provenance))
