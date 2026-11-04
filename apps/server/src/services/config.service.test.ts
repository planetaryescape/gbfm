import { Redacted, Schema, Effect } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  EditorialOAuthConfigInvalid,
  parseEditorialOAuthConfig,
} from '@/lib/editorial-oauth-config'
import { withTestLayer } from '@/test/effect'

import {
  ConfigService,
  createConfig,
  StorageConfigSchema,
  WorkerConfigServiceLayer,
  type WorkerConfigBindings,
} from './config.service'

const decodeStorageConfig = Schema.decodeUnknownSync(StorageConfigSchema)

const workerBindings = (): WorkerConfigBindings => ({
  APP_STAGE: 'd1-staging',
  USER_CONTENT_BUCKET_NAME: 'user-content',
  MIXES_BUCKET_NAME: 'mixes',
  SENTRY_ENVIRONMENT: 'd1-staging',
  SpotifyClientId: 'configured',
  SpotifyClientSecret: 'configured',
  SENTRY_BACKEND_DSN: 'configured',
  VITE_PUBLIC_SENTRY_DSN: 'configured',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'configured',
  OTEL_EXPORTER_OTLP_HEADERS: 'configured',
  CloudflareAnalyticsApiToken: 'test-analytics-token',
  BETTER_AUTH_SECRET: 'configured',
  BETTER_AUTH_URL: 'configured',
  StorageProvider: 'aws',
  StorageEndpoint: 'configured',
  StorageRegion: 'configured',
  StorageAccessKeyId: 'configured',
  StorageSecretAccessKey: 'configured',
  StorageSigningEndpoint: 'configured',
})

describe('editorial OAuth configuration', () => {
  test('invalid configuration diagnostics name only the failing fields', () => {
    for (const [owner, resource, fields] of [
      ['', 'https://valid.test/mcp', ['MCP_OWNER_USER_ID']],
      ['owner', 'https://user:synthetic-secret@invalid.test/mcp', ['MCP_RESOURCE_URL']],
    ] satisfies Array<[string, string, Array<string>]>) {
      const error = createConfig({
        ...workerBindings(),
        MCP_OWNER_USER_ID: owner,
        MCP_RESOURCE_URL: resource,
      }).mcpConfigurationError

      expect(error).toBeInstanceOf(EditorialOAuthConfigInvalid)
      expect(error?.fields).toEqual(fields)
      expect(JSON.stringify(error)).not.toContain('synthetic-secret')
    }
  })
  test('stays disabled without explicit bindings and preserves the existing auth URL', () => {
    const config = createConfig(workerBindings())
    expect(config.mcp).toBeUndefined()
    expect(config.auth.betterAuthUrl).toBe('configured')
  })

  test('derives a same-origin issuer for external and explicitly configured Portless resources', () => {
    for (const origin of ['https://editorial.example.com', 'https://editorial-test.localhost']) {
      const config = createConfig({
        ...workerBindings(),
        MCP_OWNER_USER_ID: 'owner',
        MCP_RESOURCE_URL: `${origin}/mcp`,
      })

      expect(config.mcp).toEqual({
        ownerUserId: 'owner',
        resourceUrl: `${origin}/mcp`,
        issuer: `${origin}/auth`,
      })
    }
  })

  test('rejects incomplete and malformed explicit configuration without leaking values', () => {
    for (const bindings of [
      { MCP_OWNER_USER_ID: 'owner' },
      { MCP_RESOURCE_URL: 'https://editorial.example.com/mcp' },
      { MCP_OWNER_USER_ID: '', MCP_RESOURCE_URL: 'https://editorial.example.com/mcp' },
      ...[
        'http://editorial.example.com/mcp',
        'https://user:password@editorial.example.com/mcp',
        'https://editorial.example.com/mcp?token=secret',
        'https://editorial.example.com/mcp#fragment',
        'https://editorial.example.com/auth',
      ].map((MCP_RESOURCE_URL) => ({ MCP_OWNER_USER_ID: 'owner', MCP_RESOURCE_URL })),
    ]) {
      expect(() =>
        parseEditorialOAuthConfig(bindings.MCP_OWNER_USER_ID, bindings.MCP_RESOURCE_URL),
      ).toThrow(EditorialOAuthConfigInvalid)
      const config = createConfig({ ...workerBindings(), ...bindings })
      expect(config.mcp).toBeUndefined()
      expect(config.mcpConfigurationError).toBeInstanceOf(EditorialOAuthConfigInvalid)
      expect(config.auth.betterAuthUrl).toBe('configured')
      expect(JSON.stringify(config.mcpConfigurationError)).not.toMatch(
        /password|token=secret|fragment/,
      )
    }
  })

  test('LOCAL_DEV overrides production runtime URLs without changing APP_STAGE', () => {
    const config = createConfig({
      ...workerBindings(),
      APP_STAGE: 'prod',
      LOCAL_DEV: 'true',
      FRONTEND_URL: 'https://editorial-test.localhost',
      SHARE_URL: 'https://api.editorial-test.localhost',
    })

    expect(config.app.stage).toBe('prod')
    expect(config.app.nodeEnv).toBe('development')
    expect(config.urls.frontend).toBe('https://editorial-test.localhost')
    expect(config.urls.share).toBe('https://api.editorial-test.localhost')
  })
})

describe('StorageConfigSchema', () => {
  test('uses Worker bindings instead of SST resources', () => {
    const config = createConfig(workerBindings())

    expect(config.spotify).toEqual({ clientId: 'configured', clientSecret: 'configured' })
    expect(config.auth.betterAuthSecret).toBe('configured')
  })

  test('serves production public urls rather than localhost', () => {
    const config = createConfig({ ...workerBindings(), APP_STAGE: 'prod' })

    expect(config.urls.frontend).toBe('https://goosebumps.fm')
    expect(config.urls.share).toBe('https://api.goosebumps.fm')
  })

  test('falls back to localhost urls off production', () => {
    const config = createConfig(workerBindings())

    expect(config.urls.frontend).toBe('http://127.0.0.1:5173')
    expect(config.urls.share).toBe('http://127.0.0.1:3003')
  })

  test('lets a non-prod stage override its public urls', () => {
    const config = createConfig({
      ...workerBindings(),
      FRONTEND_URL: 'https://d1-staging.goosebumps.fm',
      SHARE_URL: 'https://api.d1-staging.goosebumps.fm',
    })

    expect(config.urls.frontend).toBe('https://d1-staging.goosebumps.fm')
    expect(config.urls.share).toBe('https://api.d1-staging.goosebumps.fm')
  })

  test('points a non-prod stage at its own deployed CDN router', () => {
    const config = createConfig({
      ...workerBindings(),
      CDN_ROUTER_URL: 'https://cdn-router-d1-staging.workers.dev',
    })

    expect(config.urls.bucketRouter).toBe('https://cdn-router-d1-staging.workers.dev')
  })

  test('keeps the production CDN domain regardless of the bound router url', () => {
    const config = createConfig({
      ...workerBindings(),
      APP_STAGE: 'prod',
      CDN_ROUTER_URL: 'https://cdn-router-prod.workers.dev',
    })

    expect(config.urls.bucketRouter).toBe('https://cdn.goosebumps.fm')
  })

  test('falls back to the production CDN when no router url is bound', () => {
    const config = createConfig(workerBindings())

    expect(config.urls.bucketRouter).toBe('https://cdn.goosebumps.fm')
  })

  test('rejects an invalid configured full email sender at the Worker config boundary', () => {
    expect(() =>
      Effect.runSync(
        withTestLayer(
          ConfigService,
          WorkerConfigServiceLayer({ ...workerBindings(), EMAIL_SENDER: 'noreply' }),
        ),
      ),
    ).toThrow()
  })

  test('rejects missing production Worker secrets', () => {
    expect(() =>
      createConfig({ ...workerBindings(), APP_STAGE: 'prod', BETTER_AUTH_SECRET: '' }),
    ).toThrow('Missing required production secrets: BETTER_AUTH_SECRET')
  })

  test('accepts AWS with ambient credentials', () => {
    expect(decodeStorageConfig({ provider: 'aws', region: 'us-east-1' })).toMatchObject({
      provider: 'aws',
      region: 'us-east-1',
    })
  })

  test('uses the R2 account ID Worker binding', () => {
    const config = createConfig({
      ...workerBindings(),
      StorageProvider: 'r2',
      R2AccountId: 'test-account',
    })

    expect(config.storage.accountId).toBe('test-account')
  })

  test('rejects R2 without its account ID', () => {
    expect(() => decodeStorageConfig({ provider: 'r2', region: 'auto' })).toThrow(
      /r2 provider requires an account ID/,
    )
  })

  test('does not serialize R2 credentials', () => {
    const accessKey = 'r2-access-key-for-test'
    const secretKey = 'r2-secret-key-for-test'

    const config = decodeStorageConfig({
      provider: 'r2',
      accountId: 'account',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      region: 'auto',
      accessKeyId: Redacted.make(accessKey),
      secretAccessKey: Redacted.make(secretKey),
    })

    expect(JSON.stringify(config)).not.toContain(accessKey)
    expect(JSON.stringify(config)).not.toContain(secretKey)
  })
})
