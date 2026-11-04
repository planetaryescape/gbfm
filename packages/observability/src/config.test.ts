import { expect, test } from 'vitest'

import { telemetryConfig } from './config'

const dsn = 'https://abc123@o1.ingest.sentry.io/123'

const input = {
  application: 'mobile',
  dsn,
  enabled: 'true',
  environment: 'development',
  development: true,
  release: 'gbfm-mobile@0123456789abcdef0123456789abcdef01234567',
} satisfies Parameters<typeof telemetryConfig>[0]

test('telemetry needs explicit opt-in and a valid DSN; bad telemetry config never blocks startup', () => {
  expect(telemetryConfig(input)).toMatchObject({ enabled: true, tracesSampleRate: 1 })
  expect(telemetryConfig({ ...input, enabled: undefined }).enabled).toBe(false)
  expect(telemetryConfig({ ...input, release: undefined }).enabled).toBe(false)
  expect(telemetryConfig({ ...input, release: 'private-input' }).enabled).toBe(false)

  for (const dsn of [
    undefined,
    'invalid',
    'https://key:password@host/123',
    'https://key@host/123?token=private',
  ]) {
    expect(telemetryConfig({ ...input, dsn }).enabled).toBe(false)
  }

  expect(telemetryConfig({ ...input, development: false, environment: 'preview' })).toMatchObject({
    environment: 'preview',
    tracesSampleRate: 1,
  })
  expect(telemetryConfig({ ...input, environment: 'private-input' }).environment).toBe(
    'development',
  )
})
