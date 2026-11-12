import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Schema } from 'effect'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, expect, test } from 'vitest'

let runtime: Miniflare

let sentryRuntime: Miniflare

let directory: string

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gbfm-logger-'))
  const scriptPath = join(directory, 'worker.mjs')
  execFileSync('bun', [
    'build',
    'src/test/logger-worker.ts',
    '--target=browser',
    '--external=node:*',
    '--outfile',
    scriptPath,
  ])
  runtime = new Miniflare({
    scriptPath,
    modulesRoot: directory,
    modules: true,
    compatibilityDate: '2026-07-04',
    compatibilityFlags: ['nodejs_compat'],
  })
  const sentryScript = join(directory, 'sentry.mjs')
  execFileSync('bun', [
    'build',
    'src/test/logger-sentry-worker.ts',
    '--target=browser',
    '--external=node:*',
    '--external=cloudflare:*',
    '--outfile',
    sentryScript,
  ])
  sentryRuntime = new Miniflare({
    scriptPath: sentryScript,
    modulesRoot: directory,
    modules: true,
    compatibilityDate: '2026-07-04',
    compatibilityFlags: ['nodejs_compat'],
  })
})

afterAll(async () => {
  await runtime?.dispose()
  await sentryRuntime?.dispose()

  if (directory) await rm(directory, { recursive: true, force: true })
})

test.each(['production', 'development'])(
  'the real logger runs under workerd with redacted %s output',
  async (nodeEnv) => {
    const response = await runtime.dispatchFetch(`https://logger.example.test/${nodeEnv}`)
    expect(response.status).toBe(200)
    const logs = Schema.decodeUnknownSync(Schema.Array(Schema.String))(await response.json())
    expect(logs).toHaveLength(nodeEnv === 'production' ? 2 : 3)
    const serialized = logs.join('\n')
    expect(serialized).toContain('worker.warning')
    expect(serialized).toContain('worker.error')
    expect(serialized).toContain('kept')
    expect(serialized).toContain('[Redacted]')
    expect(serialized).not.toContain('synthetic-worker-')
  },
)

test('workerd emits the production JSON severity fields', async () => {
  const response = await runtime.dispatchFetch('https://logger.example.test/production')
  const logs = Schema.decodeUnknownSync(Schema.Array(Schema.String))(await response.json())

  const records = logs.map((line) =>
    Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({ level: Schema.Number, logLevel: Schema.String, hostname: Schema.String }),
      ),
    )(line),
  )

  expect(records.map(({ level, logLevel }) => ({ level, logLevel }))).toEqual([
    { level: 40, logLevel: 'Warn' },
    { level: 50, logLevel: 'Error' },
  ])
})

test('workerd emits readable development severity labels', async () => {
  const response = await runtime.dispatchFetch('https://logger.example.test/development')
  const logs = Schema.decodeUnknownSync(Schema.Array(Schema.String))(await response.json())
  const serialized = logs.join('\n')
  expect(serialized).toContain('INFO')
  expect(serialized).toContain('WARN')
  expect(serialized).toContain('ERROR')
})

test('the Cloudflare Sentry transport receives redacted, correlated records once', async () => {
  const traceId = '1234567890abcdef1234567890abcdef'

  const response = await sentryRuntime.dispatchFetch('https://logger.example.test/production', {
    headers: { 'sentry-trace': `${traceId}-1234567890abcdef-1` },
  })

  expect(response.status).toBe(200)

  const result = Schema.decodeUnknownSync(
    Schema.Struct({
      logs: Schema.Array(Schema.String),
      envelopes: Schema.Array(
        Schema.Tuple([
          Schema.Unknown,
          Schema.Array(Schema.Tuple([Schema.Struct({ type: Schema.String }), Schema.Unknown])),
        ]),
      ),
    }),
  )(await response.json())

  const logs = result.envelopes.flatMap(([, items]) =>
    items.flatMap(([header, payload]) =>
      header.type === 'log'
        ? Schema.decodeUnknownSync(
            Schema.Struct({
              items: Schema.Array(
                Schema.Struct({
                  body: Schema.String,
                  level: Schema.String,
                  trace_id: Schema.String,
                }),
              ),
            }),
          )(payload).items
        : [],
    ),
  )

  expect(logs.map(({ level }) => level)).toEqual(['warn', 'error'])
  expect(logs.map(({ trace_id }) => trace_id)).toEqual([traceId, traceId])
  expect(logs[0]?.body).toContain('worker.warning')
  expect(result.logs).toHaveLength(2)
  expect(JSON.stringify(result)).toContain('[Redacted]')
  expect(JSON.stringify(result)).not.toContain('synthetic-worker-')
})
