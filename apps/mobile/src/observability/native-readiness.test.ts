import { expect, test } from 'vitest'

import { decodeNativeTelemetry, nativeTelemetryMatches } from './native-readiness'

const config = {
  dsn: 'https://abc123@o1.ingest.sentry.io/123',
  release: `gbfm-mobile@${'a'.repeat(40)}`,
  environment: 'development',
}

test('JS telemetry requires a running native client with the same immutable configuration', () => {
  expect(nativeTelemetryMatches(config, decodeNativeTelemetry({ ...config, enabled: true }))).toBe(
    true,
  )
})

test.each([
  undefined,
  {},
  { ...config, enabled: false },
  { ...config, enabled: true, dsn: 'https://def456@o1.ingest.sentry.io/123' },
  { ...config, enabled: true, release: `gbfm-mobile@${'b'.repeat(40)}` },
  { ...config, enabled: true, environment: 'production' },
])('missing, disabled or mismatched native configuration fails closed: %j', (native) => {
  expect(nativeTelemetryMatches(config, decodeNativeTelemetry(native))).toBe(false)
})
