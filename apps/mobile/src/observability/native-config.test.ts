import { telemetryConfig } from '@gbfm/observability/config'
import { expect, test } from 'vitest'

import { nativeSentryConfig } from '../../plugins/with-sentry-native-privacy'

test('the native bootstrap uses the same explicit opt-in, DSN and immutable-release gates as JS', () => {
  const valid = {
    EXPO_PUBLIC_SENTRY_DSN: 'https://abc123@o1.ingest.sentry.io/123',
    EXPO_PUBLIC_SENTRY_ENABLED: 'true',
    EXPO_PUBLIC_SENTRY_RELEASE: `gbfm-mobile@${'a'.repeat(40)}`,
    EXPO_PUBLIC_SENTRY_ENVIRONMENT: 'development',
  }

  const cases: ReadonlyArray<Readonly<Record<string, string | undefined>>> = [
    valid,
    {},
    { ...valid, EXPO_PUBLIC_SENTRY_ENABLED: 'false' },
    { ...valid, EXPO_PUBLIC_SENTRY_RELEASE: 'local' },
    { ...valid, EXPO_PUBLIC_SENTRY_DSN: 'http://abc123@localhost/123' },
    { ...valid, EXPO_PUBLIC_SENTRY_DSN: 'https://abc123:private@o1.ingest.sentry.io/123' },
    { ...valid, EXPO_PUBLIC_SENTRY_DSN: 'https://abc123@o1.ingest.sentry.io/123?token=private' },
  ]

  for (const env of cases) {
    const native = nativeSentryConfig(env)

    const js = telemetryConfig({
      application: 'mobile',
      dsn: env.EXPO_PUBLIC_SENTRY_DSN,
      enabled: env.EXPO_PUBLIC_SENTRY_ENABLED,
      release: env.EXPO_PUBLIC_SENTRY_RELEASE,
      environment: env.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
      development: false,
    })

    expect(native.GBFMSentryEnabled).toBe(js.enabled)

    expect(native.GBFMSentryDsn).toBe(js.enabled ? js.dsn : '')
    expect(native.GBFMSentryRelease).toBe(js.enabled ? js.release : '')
  }
})
