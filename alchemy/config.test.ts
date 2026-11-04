import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { deploymentConfig, IncompleteDeploymentConfigError } from './config'

const requiredEnvironment = [
  'SPOTIFY_CLIENT_ID',
  'SPOTIFY_CLIENT_SECRET',
  'SENTRY_BACKEND_DSN',
  'VITE_PUBLIC_SENTRY_DSN',
  'BETTER_AUTH_SECRET',
  'CLOUDFLARE_ANALYTICS_API_TOKEN',
  'StorageRegion',
  'StorageAccessKeyId',
  'StorageSecretAccessKey',
  'ADMIN_EMAIL',
  'CLOUDFLARE_ACCOUNT_ID',
]

describe('deploymentConfig', () => {
  beforeEach(() => {
    for (const name of requiredEnvironment) vi.stubEnv(name, 'test-value')
    vi.stubEnv('ADMIN_EMAIL', 'admin@example.com')
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'fixture-account')
  })

  afterEach(() => vi.unstubAllEnvs())

  describe.each(requiredEnvironment)('%s', (name) => {
    test.each([undefined, '', ' \t\n '])('rejects a blank required value (%j)', (value) => {
      vi.stubEnv(name, value)

      const exit = Effect.runSyncExit(deploymentConfig(false))
      expect(Exit.isFailure(exit)).toBe(true)

      if (!Exit.isFailure(exit)) throw new Error('Expected deployment configuration to fail')

      const defect = exit.cause.reasons.find(Cause.isDieReason)
      expect(defect?.defect).toBeInstanceOf(IncompleteDeploymentConfigError)
      expect(defect?.defect).toEqual(new IncompleteDeploymentConfigError([name]))
    })
  })

  test('reports all missing deployment inputs together', () => {
    vi.stubEnv('ADMIN_EMAIL', undefined)
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', '')
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', ' \t ')

    const exit = Effect.runSyncExit(deploymentConfig(false))

    if (!Exit.isFailure(exit)) throw new Error('Expected deployment configuration to fail')

    const defect = exit.cause.reasons.find(Cause.isDieReason)
    expect(defect?.defect).toEqual(
      new IncompleteDeploymentConfigError([
        'SPOTIFY_CLIENT_SECRET',
        'ADMIN_EMAIL',
        'CLOUDFLARE_ACCOUNT_ID',
      ]),
    )
  })

  test('keeps plain configuration outside the Secret resources', () => {
    vi.stubEnv('ADMIN_EMAIL', ' admin@example.com ')

    const config = Effect.runSync(deploymentConfig(false))
    expect(config.adminEmail).toBe(' admin@example.com ')
    expect(config.cloudflareAccountId).toBe('fixture-account')
    expect(config.secrets).not.toHaveProperty('ADMIN_EMAIL')
    expect(config.secrets).not.toHaveProperty('adminEmail')
    expect(config.secrets).not.toHaveProperty('CLOUDFLARE_ACCOUNT_ID')
    expect(config.secrets).not.toHaveProperty('cloudflareAccountId')
  })

  test('allows local dev without required deployment inputs', () => {
    for (const name of requiredEnvironment) vi.stubEnv(name, undefined)

    const config = Effect.runSync(deploymentConfig(true))
    expect(config.adminEmail).toBe('')
    expect(config.cloudflareAccountId).toBe('')
    expect(Object.values(config.secrets).every((value) => value === '')).toBe(true)
  })
})
