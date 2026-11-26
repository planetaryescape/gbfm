import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'

import type { SecretValues } from './config'

/**
 * Creates the account's Secrets Store and every secret in it.
 *
 * Cloudflare allows one store per account, so names are stage-scoped to keep
 * prod and staging from overwriting each other.
 *
 * `alchemy dev` runs Workers under local Miniflare, which rejects
 * `secrets_store_secret` bindings outright (unsupported in local mode).
 * Local dev therefore skips the Secrets Store entirely and binds each value
 * as `secret_text` instead — a plain `Redacted<string>`, sourced from the
 * deployment config. The Worker-side reader
 * (`resolveSecretBindings`) already falls back to treating a non-store
 * binding as the resolved string, so no runtime code needed to change.
 */
export const secretsStore = (apiUrl: string, isLocalDev: boolean, values: SecretValues) =>
  Effect.gen(function* () {
    const stack = yield* Alchemy.Stack

    // Derived from the stack rather than the environment. Better Auth builds
    // emailed links from this, so a stale inherited value sends real users to
    // whichever host it last named: production's pointed at a staging Worker.
    const sources = {
      ...values,
      BETTER_AUTH_URL: apiUrl,
    } satisfies Record<string, string>

    if (isLocalDev) {
      return Object.fromEntries(
        Object.entries(sources).map(([name, value]) => [name, Redacted.make(value)]),
      )
    }

    const store = yield* Cloudflare.SecretsStore.Store('Secrets')

    const entries = yield* Effect.forEach(
      Object.entries(sources),
      ([name, value]) =>
        Cloudflare.SecretsStore.Secret(`Secret${name}`, {
          store,
          name: `${stack.stage}-${name}`,
          value: Redacted.make(value),
        }).pipe(Effect.map((secret) => [name, secret] as const)),
      { concurrency: 4 },
    )

    return Object.fromEntries(entries)
  })

export type SecretBindings = Effect.Success<ReturnType<typeof secretsStore>>
