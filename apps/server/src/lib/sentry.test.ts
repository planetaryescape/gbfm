import { describe, expect, test } from 'vitest'

import { shouldEnableSentry, withoutDatabaseAutoInstrumentation } from './sentry'

describe('shouldEnableSentry', () => {
  test.each(['prod', 'production'])('enables configured telemetry in %s', (environment) => {
    expect(shouldEnableSentry('https://public@example.com/1', environment)).toBe(true)
    expect(shouldEnableSentry('', environment)).toBe(false)
  })

  test.each(['dev', 'development', 'local', 'preview', 'staging'])(
    'keeps %s telemetry opt-in',
    (environment) => {
      expect(shouldEnableSentry('https://public@example.com/1', environment)).toBe(false)
      expect(shouldEnableSentry('https://public@example.com/1', environment, true)).toBe(true)
    },
  )
})

describe('withoutDatabaseAutoInstrumentation', () => {
  test('removes database integrations while preserving the remaining defaults', () => {
    const integrations = [
      { name: 'Http' },
      { name: 'Postgres' },
      { name: 'PostgresJs' },
      { name: 'OnUncaughtException' },
    ]

    expect(withoutDatabaseAutoInstrumentation(integrations)).toEqual([
      { name: 'Http' },
      { name: 'OnUncaughtException' },
    ])
  })
})
