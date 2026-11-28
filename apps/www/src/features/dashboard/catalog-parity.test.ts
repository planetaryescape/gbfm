import { TestHost } from '@effect/ui/testing'
import { Deferred, Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { runWithLayer } from '../player/testing'
import { CatalogMessage, DashboardCatalogNoDeps, WriteCatalog } from './catalog'
import { type DashboardDocument, emptyDocument } from './document'
import { type DashboardRequest, DashboardService, ReadDashboard } from './service'

describe('native catalogue query ownership parity', () => {
  it('rejects old link results after a mutation refresh without discarding unsaved metadata', async () => {
    const staleLinks = await Effect.runPromise(Deferred.make<DashboardDocument>())

    const document = {
      ...emptyDocument,
      fields: { id: 'album', title: 'Saved title', slug: 'album', revision: '8' },
    }

    let linkReads = 0
    const writes: Array<DashboardRequest> = []

    const service = Layer.succeed(DashboardService, {
      request: (request: DashboardRequest) => {
        if (request.method) {
          writes.push(request)

          return Effect.succeed(emptyDocument)
        }

        if (request.path.endsWith('/links')) {
          linkReads++

          if (linkReads === 1) return Deferred.await(staleLinks)

          return Effect.succeed({
            ...emptyDocument,
            rows: [{ id: 'new', title: 'Current source', detail: '', href: null, actionId: 'new' }],
          })
        }

        return Effect.succeed(document)
      },
      readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
      writePlayerPreferences: () => Effect.void,
    })

    const layer = Layer.mergeAll(ReadDashboard.layer, WriteCatalog.layer).pipe(
      Layer.provide(service),
    )

    await runWithLayer(
      Layer.merge(layer, TestHost.layer()),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(DashboardCatalogNoDeps, {
          principal: { id: 'admin', name: null, username: null, role: 'admin' },
          section: 'music-entity/album/album',
          url: '/dashboard/music-entity/album/album',
          initialDocument: document,
        })

        root.send(CatalogMessage.ClickedRefresh())
        yield* TestHost.settle
        root.send(CatalogMessage.UpdatedField({ name: 'title', value: 'An unsaved title' }))
        root.send(
          CatalogMessage.UpdatedField({ name: 'linkUrl', value: 'https://example.test/source' }),
        )
        root.send(CatalogMessage.ClickedAction({ action: 'add-link', linkId: '' }))
        yield* TestHost.settle
        expect(writes).toHaveLength(1)
        expect(root.model()?.fields.title).toBe('An unsaved title')
        expect(root.text()).toContain('Current source')
        yield* Deferred.succeed(staleLinks, {
          ...emptyDocument,
          rows: [{ id: 'old', title: 'Obsolete source', detail: '', href: null, actionId: 'old' }],
        })
        yield* TestHost.settle
        expect(root.text()).not.toContain('Obsolete source')
        expect(root.text()).toContain('Current source')
        expect(root.model()?.fields.title).toBe('An unsaved title')
      }),
    )
  })
})
