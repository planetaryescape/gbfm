import { Component } from '@effect/ui'
import { BrowserHost } from '@effect/ui/html'
import { KeyMetadata } from '@gbfm/api/personal-access-keys'
import { Effect, Layer, Redacted, Schema } from 'effect'

import {
  apiKeyOperationsLayer,
  DashboardApiKeysNoDeps,
} from '../../src/features/dashboard/api-keys'
import { KeyRequestError, KeyService } from '../../src/page/dashboard/page/api-keys/service'

const key = Schema.decodeUnknownSync(KeyMetadata)({
  id: 'c63400ba-984d-4d4e-91ce-3b1722cc28f2',
  ownerUserId: 'owner',
  name: 'Fixture agent',
  environment: 'dev',
  scopes: ['posts:read'],
  displayPrefix: 'gbfm_pat_v1_dev_abcdef',
  createdAt: '2026-11-02T10:00:00.000Z',
  expiresAt: '2026-12-02T10:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
})

const fixtureLayer = Layer.succeed(KeyService, {
  list: () =>
    Effect.succeed({ data: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } }),
  confirmPassword: (_userId, password) =>
    Redacted.value(password) === 'fixture-wrong'
      ? Effect.fail(new KeyRequestError({ message: 'Incorrect password. Try again.' }))
      : Effect.void,
  revoke: () => Effect.void,
  issue: () =>
    Effect.gen(function* () {
      document.body.dataset.issued = String(Number(document.body.dataset.issued ?? 0) + 1)

      if (document.body.dataset.pauseIssue === 'true') {
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              document.addEventListener('fixture-release-issue', () => resolve(), { once: true })
            }),
        )
      }

      return {
        key,
        secret: Redacted.make('fixture-secret-visible-once'),
      }
    }),
})

const Fixture = DashboardApiKeysNoDeps.pipe(
  Component.provide(apiKeyOperationsLayer.pipe(Layer.provideMerge(fixtureLayer))),
)

const root = document.getElementById('app')

if (root) {
  Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        const mounted = yield* BrowserHost.mountEffect(
          Fixture,
          { principal: { id: 'owner', name: 'Fixture', username: 'fixture', role: 'admin' } },
          root,
        )

        document.addEventListener('fixture-snapshot', () => {
          document.body.dataset.modelSnapshot = JSON.stringify(mounted.model())
        })
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              document.addEventListener('fixture-unmount', () => resolve(), { once: true })
            }),
        )
      }),
    ),
  )
}
