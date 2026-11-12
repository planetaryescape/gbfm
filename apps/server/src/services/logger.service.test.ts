import { spawnSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'

import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

const fixture = fileURLToPath(new URL('../test/logger-fixture.ts', import.meta.url))

const RecordValue = Schema.Record(Schema.String, Schema.Unknown)

const LogRecord = Schema.Struct({
  level: Schema.Number,
  time: Schema.Number,
  pid: Schema.Number,
  hostname: Schema.String,
  annotations: RecordValue,
  cause: RecordValue,
  fiberId: Schema.Number,
  date: RecordValue,
  logLevel: Schema.String,
  msg: Schema.String,
})

const SentryLogs = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      level: Schema.String,
      body: Schema.String,
      trace_id: Schema.String,
      attributes: Schema.Record(
        Schema.String,
        Schema.Struct({ type: Schema.String, value: Schema.Unknown }),
      ),
    }),
  ),
})

const Envelopes = Schema.Array(
  Schema.Tuple([
    Schema.Unknown,
    Schema.Array(Schema.Tuple([Schema.Struct({ type: Schema.String }), Schema.Unknown])),
  ]),
)

function capture(nodeEnv: string, logLevel = 'default', scenario = 'levels') {
  const result = spawnSync('bun', ['--no-env-file', fixture, nodeEnv, logLevel, scenario], {
    env: { PATH: process.env.PATH, FORCE_COLOR: '0' },
    encoding: 'utf8',
    timeout: 10_000,
  })

  expect(result.status).toBe(0)
  const { stdout, stderr } = result
  const envelopes = Schema.decodeUnknownSync(Schema.fromJsonString(Envelopes))(stderr)

  const sentry = envelopes.flatMap(([, items]) =>
    items.flatMap(([header, payload]) =>
      header.type === 'log' ? Schema.decodeUnknownSync(SentryLogs)(payload).items : [],
    ),
  )

  return { stdout, stderr, sentry }
}

const parseLines = (stdout: string) =>
  stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => Schema.decodeUnknownSync(Schema.fromJsonString(LogRecord))(line))

describe('application log output', () => {
  it('preserves the production JSON field contract and mapped severities', () => {
    const { stdout } = capture('production')
    const records = parseLines(stdout)
    expect(records.map(({ level, logLevel, msg }) => ({ level, logLevel, msg }))).toEqual([
      { level: 40, logLevel: 'Warn', msg: 'fixture.warn' },
      { level: 50, logLevel: 'Error', msg: 'fixture.error' },
      { level: 50, logLevel: 'Fatal', msg: 'fixture.fatal' },
    ])

    for (const record of records) {
      expect(record.time).toBeGreaterThan(0)
      expect(record.pid).toBeGreaterThan(0)
      expect(record.hostname).not.toBe('')
      expect(record.fiberId).toBeGreaterThan(0)
      expect(record.date).toEqual({})
      expect(record.cause).toEqual({ '~effect/Cause': '~effect/Cause', reasons: [] })
    }

    expect(records[0]?.annotations).toEqual({
      operation: 'fixture.operation',
      requestId: 'fixture-request',
    })
  })

  it.each([
    ['trace', [20, 20, 30, 40, 50, 50]],
    ['debug', [20, 20, 30, 40, 50, 50]],
    ['info', [30, 40, 50, 50]],
    ['warn', [40, 50, 50]],
    ['error', [50, 50]],
    ['fatal', []],
    ['silent', []],
  ])('honours the configured %s console threshold', (level, expected) => {
    const { stdout, sentry } = capture('production', level)
    expect(parseLines(stdout).map((record) => record.level)).toEqual(expected)
    expect(sentry.map((record) => record.level)).toEqual(['warn', 'error', 'fatal'])
  })

  it('keeps development readable with info as the default threshold', () => {
    const { stdout } = capture('development')
    expect(stdout).toContain('INFO')
    expect(stdout).toContain('fixture.info {"count":2}')
    expect(stdout).toContain('WARN')
    expect(stdout).toContain('fixture.operation')
    expect(stdout).toContain('ERROR')
    expect(stdout).not.toContain('fixture.debug')
    expect(stdout).not.toContain('fixture.trace')
  })

  it('forwards each warning and higher once with active Sentry trace correlation', () => {
    const { sentry } = capture('production')
    expect(sentry.map(({ level, body }) => ({ level, body }))).toEqual([
      { level: 'warn', body: 'fixture.warn' },
      { level: 'error', body: 'fixture.error' },
      { level: 'fatal', body: 'fixture.fatal' },
    ])
    expect(new Set(sentry.map((record) => record.trace_id)).size).toBe(1)

    for (const record of sentry) {
      expect(record.trace_id).toMatch(/^[0-9a-f]{32}$/)
      expect(record.attributes['sentry.trace.parent_span_id']?.value).toMatch(/^[0-9a-f]{16}$/)
      expect(record.attributes.logLevel?.value).toBeDefined()
      expect(record.attributes.fiberId?.value).toBeGreaterThan(0)
    }

    expect(sentry[0]?.attributes.annotations?.value).toBe(
      '{"operation":"fixture.operation","requestId":"fixture-request"}',
    )
  })

  it.each(['production', 'development'])(
    'redacts nested message, annotation and cause keys before %s output and Sentry export',
    (nodeEnv) => {
      const { stdout, stderr, sentry } = capture(nodeEnv, 'debug', 'privacy')
      expect(sentry).toHaveLength(2)
      expect(stdout).toContain('fixture.privacy')
      expect(stdout).toContain('kept')
      expect(stdout).toContain('[Redacted]')
      expect(stderr).toContain('[Redacted]')

      expect(stdout).not.toContain('synthetic-')
      expect(stderr).not.toContain('synthetic-')
    },
  )
  it('retains console output and a successful program when the Sentry transport rejects', () => {
    const { stdout, sentry } = capture('production', 'default', 'transport-failure')
    expect(parseLines(stdout).map((record) => record.msg)).toEqual([
      'fixture.warn',
      'fixture.error',
      'fixture.fatal',
    ])
    expect(sentry).toEqual([])
  })
})
