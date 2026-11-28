import { Html } from '@effect/ui/html'
import { Locator, Scene, Story, TestHost } from '@effect/ui/testing'
import { Effect, Layer, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { runWithLayer } from '../player/testing'
import { DashboardAdminPanelNoDeps, ReadPanelClock, SaveFeatured } from './admin-panels'
import { CollectionMessage, DashboardCollectionNoDeps, RemoveSavedItem } from './collection'
import { DashboardDocument, emptyDocument } from './document'
import { DashboardPage } from './index'
import { DashboardLibraryNoDeps, LibraryMessage, WriteLibrary } from './library'
import { Pagination } from './presentation'
import { makeDashboardServiceLayer, ReadDashboard } from './service'

const principal = { id: 'listener', name: null, username: null, role: 'user' }

const PaginationFixture = Html.component({
  name: 'DashboardPaginationFixture',
  props: Schema.Struct({ document: DashboardDocument }),
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) => h.div.children(Pagination(h, h.props.document, '/dashboard/email-logs?status=SENT')),
})

describe('legacy retirement gates, assertions retained without skips or expected failures', () => {
  it('hides creator-only content navigation from a listener', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(DashboardPage, {
            principal,
            url: '/dashboard/profile',
            document: emptyDocument,
          })

          for (const href of [
            '/dashboard/content/mixes',
            '/dashboard/content/tweets',
            '/dashboard/content/editorial',
          ])
            expect(s.current.query(Locator.attr('href', href))).toBeUndefined()
        }),
      ),
    ))

  it('retains an uncertain removal intent across refresh, including when the row disappears', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardCollectionNoDeps, {
            principal,
            section: 'favorites',
            url: '/dashboard/favorites',
            initialDocument: {
              ...emptyDocument,
              rows: [
                {
                  id: 'saved',
                  title: 'Fixture',
                  detail: '',
                  href: null,
                  actionId: 'audio',
                  membershipRevision: 7,
                },
              ],
            },
          })

          const intent = {
            principalId: principal.id,
            section: 'favorites',
            rowId: 'saved',
            path: '/api/favorites/audio',
            expectedRevision: 7,
            requestId: '6da42445-0ad9-4df5-aeb4-4c20d2cd440c',
          }

          s.send(CollectionMessage.ClickedRemove({ id: 'saved' })).resolve(
            RemoveSavedItem,
            CollectionMessage.FailedRemove({ intent, status: null, message: 'Response lost' }),
          )
          s.send(CollectionMessage.ClickedRefresh()).loaded('document', emptyDocument)
          expect(s.model.pending).toEqual(intent)
          s.send(CollectionMessage.ClickedRemove({ id: 'saved' }))
            .expectExact(RemoveSavedItem.make({ intent }))
            .resolve(RemoveSavedItem, CollectionMessage.SucceededRemove({ intent }))
            .loaded('document', emptyDocument)
        }),
      ),
    ))

  it('does not label an in-flight show deletion as a save', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(DashboardLibraryNoDeps, {
            principal: { ...principal, role: 'admin' },
            section: 'shows',
            initialDocument: {
              ...emptyDocument,
              shows: {
                data: [
                  {
                    id: 'show',
                    title: 'Show',
                    slug: 'show',
                    description: null,
                    content: '',
                    thumbnailUrl: null,
                    bannerImageUrl: null,
                    tags: [],
                    draft: true,
                    createdAt: '2026-01-01',
                    updatedAt: '2026-01-01',
                    hosts: [],
                  },
                ],
                pagination: { total: 1, limit: 25, offset: 0, hasMore: false },
              },
            },
          })

          s.click('Edit').click('Delete').click('Confirm delete').keepPending(WriteLibrary)
          expect(s.current.query(Locator.text('Saving…'))).toBeUndefined()
          expect(s.current.query(Locator.text('Saving', { exact: true }))).toBeUndefined()
          expect(s.current.query(Locator.text('Save changes', { exact: true }))).toBeDefined()
          s.resolve(WriteLibrary, LibraryMessage.FailedWrite({ message: 'Unavailable' }))
        }),
      ),
    ))

  it('reports no results for an empty paginated response', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(PaginationFixture, {
            document: {
              ...emptyDocument,
              pagination: { offset: 0, limit: 25, total: 0, hasMore: false },
            },
          })

          expect(s.current.query(Locator.text('No results'))).toBeDefined()
          expect(s.current.query(Locator.text('1 to 0 of 0'))).toBeUndefined()
        }),
      ),
    ))

  it.each([403, 503])(
    'maps unavailable connections (%s) to an explicit non-error state rather than a retry loop',
    async (status) => {
      const layer = Layer.mergeAll(
        ReadDashboard.layer,
        ReadPanelClock.layer,
        SaveFeatured.layer,
      ).pipe(Layer.provide(makeDashboardServiceLayer(async () => new Response(null, { status }))))

      await runWithLayer(
        Layer.merge(layer, TestHost.layer()),
        Effect.gen(function* () {
          const root = yield* TestHost.mount(DashboardAdminPanelNoDeps, {
            principal,
            section: 'connections',
            url: '/dashboard/connections',
            initialDocument: { ...emptyDocument, connections: [] },
          })

          Locator.fire(root.get(Locator.text('Refresh')), 'click')
          yield* TestHost.settle
          expect(root.text()).toContain('App connections are not available')
          expect(root.query(Locator.attr('role', 'alert'))).toBeUndefined()
          expect(root.query(Locator.attr('role', 'status'))).toBeDefined()
          expect(root.query(Locator.text('Refresh'))).toBeUndefined()
        }),
      )
    },
  )
})
