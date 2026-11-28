import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { runWithLayer } from '../player/testing'
import { emptyDocument } from './document'
import { type DashboardRequest, DashboardService } from './service'
import { DashboardSettingsNoDeps, settingsOperationsLayer } from './settings'

describe('native profile save parity', () => {
  it('submits an edited profile through the existing PATCH API rather than saving only local state', async () => {
    const requests: Array<DashboardRequest> = []

    const service = Layer.succeed(DashboardService, {
      request: (request: DashboardRequest) =>
        Effect.sync(() => {
          requests.push(request)

          return emptyDocument
        }),
      readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
      writePlayerPreferences: () => Effect.void,
    })

    const layer = settingsOperationsLayer.pipe(Layer.provide(service))
    await runWithLayer(
      Layer.merge(layer, TestHost.layer()),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(DashboardSettingsNoDeps, {
          section: 'profile',
          initialDocument: {
            ...emptyDocument,
            fields: {
              username: 'listener',
              email: 'old@example.test',
              bio: 'About me',
            },
          },
        })

        Locator.fire(root.get(Locator.attr('name', 'email')), 'input', {
          value: 'listener@example.test',
        })
        Locator.fire(root.get(Locator.text('Save changes')), 'click')
        yield* TestHost.settle
        expect(requests).toEqual([
          {
            path: '/api/user/profile',
            method: 'PATCH',
            body: JSON.stringify({
              username: 'listener',
              email: 'listener@example.test',
              bio: 'About me',
            }),
          },
        ])
        expect(root.text()).toContain('Changes saved.')
      }),
    )
  })
})
