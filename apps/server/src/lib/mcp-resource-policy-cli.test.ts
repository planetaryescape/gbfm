import { spawnSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'

import { expect, test } from 'vitest'

const script = fileURLToPath(new URL('../../scripts/mcp-resource-policy.ts', import.meta.url))

test.each([
  {
    environment: 'preview',
    database: 'production-db',
    expected: 'preview-db',
    resource: 'https://preview.example.test/mcp',
  },
  {
    environment: 'production',
    database: 'wrong-db',
    expected: 'production-db',
    resource: 'https://api.goosebumps.fm/mcp',
  },
  {
    environment: 'preview',
    database: 'preview-db',
    expected: 'preview-db',
    resource: 'https://api.goosebumps.fm/mcp',
  },
  {
    environment: 'production',
    database: 'production-db',
    expected: 'production-db',
    resource: 'https://preview.example.test/mcp',
  },
])(
  'operator CLI rejects mismatched database/resource targets before remote work: $environment $resource',
  ({ environment, database, expected, resource }) => {
    const result = spawnSync(
      'bun',
      [
        '--no-env-file',
        script,
        'inspect',
        `--environment=${environment}`,
        `--resource=${resource}`,
      ],
      {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          PATH: process.env.PATH,
          D1_ENVIRONMENT: environment,
          D1_DATABASE_ID: database,
          D1_PRODUCTION_DATABASE_ID: 'production-db',
          D1_PREVIEW_DATABASE_ID: expected,
        },
      },
    )

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toEqual({
      error: 'McpPolicyError',
      reason: 'target_mismatch',
    })
  },
)

test('operator CLI requires explicit apply confirmation and does not print credentials', () => {
  const result = spawnSync(
    'bun',
    [
      '--no-env-file',
      script,
      'apply',
      '--environment=preview',
      '--resource=https://preview.example.test/mcp',
      '--plan=never-read.json',
    ],
    {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        PATH: process.env.PATH,
        D1_ENVIRONMENT: 'preview',
        D1_DATABASE_ID: 'preview-db',
        D1_PREVIEW_DATABASE_ID: 'preview-db',
        D1_PRODUCTION_DATABASE_ID: 'production-db',
        CLOUDFLARE_ACCOUNT_ID: 'synthetic-account',
        CLOUDFLARE_API_TOKEN: 'synthetic-test-token-never-used',
      },
    },
  )

  expect(result.status).toBe(1)
  expect(result.stdout).toBe('')
  expect(JSON.parse(result.stderr)).toEqual({ error: 'McpPolicyError', reason: 'invalid_plan' })
  expect(result.stderr).not.toContain('synthetic-test-token-never-used')
})
