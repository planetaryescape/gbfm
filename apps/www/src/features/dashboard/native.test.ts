import { Locator, Scene, Story } from '@effect/ui/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  AnnouncementMessage,
  DashboardAnnouncementsNoDeps,
  SendAnnouncement,
} from './announcements'
import { CatalogMessage, DashboardCatalogNoDeps } from './catalog'
import { CollectionMessage, DashboardCollectionNoDeps, RemoveSavedItem } from './collection'
import { emptyDocument } from './document'
import { DashboardLibraryNoDeps, LibraryMessage, WriteLibrary } from './library'

const principal = { id: 'listener', name: 'Listener', username: 'listener', role: 'admin' }

const requestId = '6da42445-0ad9-4df5-aeb4-4c20d2cd440c'

describe('native dashboard section interactions', () => {
  it('blocks every catalogue write for a non-administrator even when messages bypass the view', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardCatalogNoDeps, {
            principal: { ...principal, role: 'user' },
            section: 'music-entity/track/track-1',
            url: 'https://gbfm.test/dashboard/music-entity/track/track-1',
            initialDocument: { ...emptyDocument, fields: { id: 'track-1', revision: '8' } },
          })

          s.send(CatalogMessage.ClickedDelete()).expectNone()

          const actions: ReadonlyArray<
            'save' | 'delete' | 'add-link' | 'remove-link' | 'create-label'
          > = ['save', 'delete', 'add-link', 'remove-link', 'create-label']

          for (const action of actions) {
            s.send(CatalogMessage.ClickedAction({ action, linkId: 'link-1' })).expectNone()
          }

          expect(s.model.busy).toBe(false)
          expect(s.model.pending).toBeNull()
        }),
      ),
    ))

  it('blocks playlist writes and forged track operations for a non-administrator', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardLibraryNoDeps, {
            principal: { ...principal, role: 'user' },
            section: 'playlists',
            initialDocument: emptyDocument,
          })

          s.send(LibraryMessage.ClickedDelete()).expectNone()

          const actions: ReadonlyArray<
            'save' | 'import' | 'add' | 'remove' | 'reorder' | 'sync' | 'delete'
          > = ['save', 'import', 'add', 'remove', 'reorder', 'sync', 'delete']

          for (const action of actions) {
            s.send(LibraryMessage.ClickedAction({ action, trackId: 'forged-track' })).expectNone()
          }

          s.send(LibraryMessage.ClickedMove({ id: 'forged-track', direction: 'up' })).expectNone()
          expect(s.model.busy).toBe(false)
          expect(s.model.selected).toBeNull()
        }),
      ),
    ))

  it('pins an uncertain favorite removal to the observed revision and request ID on retry', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(DashboardCollectionNoDeps, {
            principal,
            section: 'favorites',
            url: 'https://gbfm.test/dashboard/favorites',
            initialDocument: {
              ...emptyDocument,
              rows: [
                {
                  id: 'favorite-1',
                  title: 'Fixture mix',
                  detail: 'mix',
                  href: '/mixes/fixture',
                  actionId: 'audio-1',
                  membershipRevision: 4,
                },
              ],
            },
          })

          const intent = {
            principalId: 'listener',
            section: 'favorites',
            rowId: 'favorite-1',
            path: '/api/favorites/audio-1',
            expectedRevision: 4,
            requestId: null,
          }

          s.click('Remove')
            .expectExact(RemoveSavedItem.make({ intent }))
            .resolve(
              RemoveSavedItem,
              CollectionMessage.FailedRemove({
                intent: { ...intent, requestId },
                message: 'Connection lost.',
                status: null,
              }),
            )
            .expect(Locator.text('Connection lost.'))
            .toExist()
            .click('Retry removal')
            .expectExact(RemoveSavedItem.make({ intent: { ...intent, requestId } }))
            .resolve(
              RemoveSavedItem,
              CollectionMessage.SucceededRemove({ intent: { ...intent, requestId } }),
            )
            .loaded('document', emptyDocument)
          expect(s.current.query(Locator.text('Fixture mix'))).toBeUndefined()
        }),
      ),
    ))

  it('does not issue a removal when the list has no observed membership revision', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(DashboardCollectionNoDeps, {
            principal,
            section: 'favorites',
            url: 'https://gbfm.test/dashboard/favorites',
            initialDocument: {
              ...emptyDocument,
              rows: [
                { id: 'favorite-1', title: 'Fixture', detail: '', href: null, actionId: 'audio-1' },
              ],
            },
          })

          s.click('Remove').expectNone()
          expect(
            s.current.query(Locator.text('Reload to observe the saved item before removing it.')),
          ).toBeDefined()
        }),
      ),
    ))

  it('asks for confirmation before deleting a show and preserves the selected slug', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(DashboardLibraryNoDeps, {
            principal,
            section: 'shows',
            initialDocument: {
              ...emptyDocument,
              shows: {
                data: [
                  {
                    id: 'show-1',
                    title: 'Fixture show',
                    slug: 'fixture-show',
                    description: null,
                    content: '',
                    thumbnailUrl: null,
                    bannerImageUrl: null,
                    tags: [],
                    draft: true,
                    createdAt: '2026-11-26T00:00:00.000Z',
                    updatedAt: '2026-11-26T00:00:00.000Z',
                    hosts: [],
                  },
                ],
                pagination: { total: 1, limit: 25, offset: 0, hasMore: false },
              },
            },
          })

          s.click('Edit')
            .click('Delete')
            .expectNone()
            .expect(Locator.text('Permanently delete this item?'))
            .toExist()
            .click('Confirm delete')
            .expectExact(
              WriteLibrary.make({
                section: 'shows',
                action: 'delete',
                selected: 'fixture-show',
                draft: true,
                trackId: '',
                trackIds: [],
                fields: {
                  title: 'Fixture show',
                  slug: 'fixture-show',
                  description: '',
                  content: '',
                  thumbnailUrl: '',
                  bannerImageUrl: '',
                  tags: '',
                  revision: '',
                },
              }),
            )
            .resolve(
              WriteLibrary,
              LibraryMessage.SucceededWrite({
                action: 'delete',
                selected: null,
                notice: 'Show deleted.',
              }),
            )
            .loaded('document', emptyDocument)
          expect(s.current.query(Locator.text('Show deleted.'))).toBeDefined()
        }),
      ),
    ))

  it('does not expose send before a recipient review and explicit confirmation', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(DashboardAnnouncementsNoDeps, {
            principal,
            initialDocument: {
              ...emptyDocument,
              announcementOptions: { mixes: [], recipients: [] },
            },
          })

          expect(s.current.query(Locator.text('Send announcement'))).toBeUndefined()
          s.click('Review recipients').expectNone()
          s.expect(Locator.text('Send announcement')).toBeAbsent()
        }),
      ),
    ))

  it('does not offer to repeat an announcement whose delivery acknowledgement was lost', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const options = {
            mixes: [{ slug: 'fixture-mix', title: 'Fixture mix' }],
            recipients: ['listener@example.test'],
          }

          const s = yield* Scene.make(DashboardAnnouncementsNoDeps, {
            principal,
            initialDocument: { ...emptyDocument, announcementOptions: options },
          })

          s.fire(Locator.attr('name', 'mixSlug'), 'change', { value: 'fixture-mix' })
            .click('Review recipients')
            .loaded('review', { ...emptyDocument, announcementOptions: options })
            .click(Locator.tag('input'))
            .click('Send announcement')
            .expectExact(SendAnnouncement.make({ payload: { mixSlug: 'fixture-mix' } }))
            .resolve(SendAnnouncement, AnnouncementMessage.FailedSend())
          expect(
            s.current.query(Locator.text('Check delivery history before sending again')),
          ).toBeDefined()
          s.expect(Locator.text('Send announcement')).toBeAbsent()
        }),
      ),
    ))
})
