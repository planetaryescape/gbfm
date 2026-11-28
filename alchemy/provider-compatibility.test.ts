import { fileURLToPath, URL } from 'node:url'

import * as Cloudflare from '@alchemy.run/cloudflare'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { PlatformServices } from 'alchemy/Util/PlatformServices'
import { Effect, ManagedRuntime } from 'effect'
import { Digest, SecureRandom } from 'effect/crypto'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { describe, expect, it } from 'vitest'

const directory = fileURLToPath(new URL('../', import.meta.url))

describe('Alchemy provider compatibility', () => {
  it.each([
    ['Worker', Cloudflare.Worker.Type, 'Cloudflare.Worker'],
    ['Database', Cloudflare.D1.Database.Type, 'Cloudflare.D1Database'],
    ['Bucket', Cloudflare.R2.Bucket.Type, 'Cloudflare.R2.Bucket'],
    ['Namespace', Cloudflare.KV.Namespace.Type, 'Cloudflare.KV.Namespace'],
    ['Queue', Cloudflare.Queues.Queue.Type, 'Cloudflare.Queues.Queue'],
    ['Consumer', Cloudflare.Queues.Consumer.Type, 'Cloudflare.Queues.Consumer'],
    ['Widget', Cloudflare.Turnstile.Widget.Type, 'Cloudflare.Turnstile.Widget'],
    ['Store', Cloudflare.SecretsStore.Store.Type, 'Cloudflare.SecretsStore'],
    ['Secret', Cloudflare.SecretsStore.Secret.Type, 'Cloudflare.SecretsStore.Secret'],
    ['Zone', Cloudflare.Zone.Zone.Type, 'Cloudflare.Zone.Zone'],
    ['Ruleset', Cloudflare.Ruleset.Ruleset.Type, 'Cloudflare.Ruleset.Ruleset'],
    ['Routing', Cloudflare.Email.Routing.Type, 'Cloudflare.Email.Routing'],
    [
      'SendingSubdomain',
      Cloudflare.Email.SendingSubdomain.Type,
      'Cloudflare.Email.SendingSubdomain',
    ],
  ])('preserves the persisted %s resource type', (_name, actual, expected) => {
    expect(actual).toBe(expected)
  })

  it('preserves Analytics Engine binding identity and explicit or default dataset names', async () => {
    const explicit = await Effect.runPromise(
      Cloudflare.AnalyticsEngine.Dataset('ApiRequestTelemetry', { dataset: 'gbfm_api_prod' }),
    )

    const defaulted = await Effect.runPromise(
      Cloudflare.AnalyticsEngine.Dataset('BrowserTelemetry'),
    )

    expect(explicit).toEqual({
      kind: 'Cloudflare.AnalyticsEngine.Dataset',
      name: 'ApiRequestTelemetry',
      dataset: 'gbfm_api_prod',
    })
    expect(defaulted).toEqual({
      kind: 'Cloudflare.AnalyticsEngine.Dataset',
      name: 'BrowserTelemetry',
      dataset: 'BrowserTelemetry',
    })
  })

  it.each([
    {
      name: 'Bun source',
      executable: 'bun',
      args: ['--eval', 'await import("./alchemy.run.ts")'],
    },
    {
      name: 'default JavaScript',
      executable: 'node',
      args: [
        '--input-type=module',
        '--eval',
        'await import("alchemy"); await import("alchemy/Auth/OAuthFlow")',
      ],
    },
  ])(
    'loads $name modules without executing the stack',
    async ({ executable, args }) => {
      const runtime = ManagedRuntime.make(NodeServices.layer)

      try {
        const exitCode = await runtime.runPromise(
          Effect.gen(function* () {
            const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

            return yield* spawner.exitCode(ChildProcess.make(executable, args, { cwd: directory }))
          }).pipe(Effect.timeout('30 seconds')),
        )

        expect(exitCode).toBe(0)
      } finally {
        await runtime.dispose()
      }
    },
    45_000,
  )

  it('supplies digest and secure random services through the Alchemy platform layer', async () => {
    const runtime = ManagedRuntime.make(PlatformServices)

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const digest = yield* Digest.Digest
          const random = yield* SecureRandom.SecureRandom

          return {
            hash: yield* digest.digestHex(Digest.sha256, new TextEncoder().encode('abc')),
            bytes: yield* random.randomBytes(32),
            uuid: yield* random.uuidV4(),
          }
        }),
      )

      expect(result.hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
      expect(result.bytes).toHaveLength(32)
      expect(result.uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    } finally {
      await runtime.dispose()
    }
  })
})
