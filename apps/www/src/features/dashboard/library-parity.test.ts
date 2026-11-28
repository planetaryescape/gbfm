import { Story, TestHost } from '@effect/ui/testing'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { runWithLayer } from '../player/testing'
import { emptyDocument } from './document'
import { DashboardLibraryNoDeps, LibraryMessage, WriteLibrary } from './library'
import {
  type DashboardRequest,
  DashboardRequestError,
  DashboardService,
  ReadDashboard,
} from './service'

const principal = { id: 'admin', name: null, username: null, role: 'admin' }

const playlist = {
  id: 'second',
  title: 'Second playlist',
  slug: 'second-playlist',
  description: null,
  coverImageUrl: null,
  curatorId: null,
  publishedAt: null,
  createdById: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const tracks = ['one', 'two'].map((id, position) => ({
  track: {
    id,
    revision: 0,
    title: id,
    artistNames: [],
    coverImageUrl: null,
    albumId: null,
    trackNumber: null,
    slug: id,
    publishedAt: null,
    createdById: null,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  },
  position,
  addedAt: playlist.createdAt,
  links: [],
}))

describe('native playlist write parity', () => {
  it('does not save a previous playlist draft when the newly selected playlist tracks fail to load', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const first = { ...playlist, id: 'first', title: 'First playlist', slug: 'first' }

          const s = yield* Story.make(DashboardLibraryNoDeps, {
            principal,
            section: 'playlists',
            initialDocument: { ...emptyDocument, playlists: [first, playlist] },
          })

          s.send(LibraryMessage.ClickedEdit({ id: first.id })).loaded('tracks', emptyDocument)
          s.send(
            LibraryMessage.UpdatedField({ name: 'title', value: 'Unsaved first playlist' }),
          ).expectNone()
          s.send(LibraryMessage.ClickedEdit({ id: playlist.id })).loadFailed(
            'tracks',
            new DashboardRequestError({ status: 500, message: 'Tracks unavailable' }),
          )
          expect(s.model.fields.title).toBe('Second playlist')
          expect(s.model.selected).toBe('second')
          const fields = s.model.fields
          s.send(LibraryMessage.ClickedAction({ action: 'save', trackId: '' }))
            .expectExact(
              WriteLibrary.make({
                section: 'playlists',
                action: 'save',
                selected: 'second',
                fields,
                draft: true,
                trackId: '',
                trackIds: [],
              }),
            )
            .resolve(WriteLibrary, LibraryMessage.FailedWrite({ message: 'Unavailable' }))
        }),
      ),
    ))

  it('keeps a stale playlist selection but clears its old form when a reset reload no longer contains it', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardLibraryNoDeps, {
            principal,
            section: 'playlists',
            initialDocument: { ...emptyDocument, playlists: [playlist] },
          })

          s.send(LibraryMessage.ClickedEdit({ id: playlist.id })).loaded('tracks', emptyDocument)
          s.send(LibraryMessage.ClickedAction({ action: 'save', trackId: '' }))
            .resolve(
              WriteLibrary,
              LibraryMessage.SucceededWrite({
                action: 'save',
                selected: playlist.id,
                notice: 'Playlist changes saved.',
              }),
            )
            .loaded('document', { ...emptyDocument, playlists: [] })
            .loaded('tracks', emptyDocument)
          expect(s.model.selected).toBe(playlist.id)
          expect(s.model.fields.title).toBe('')
          expect(s.model.fields.slug).toBe('')
        }),
      ),
    ))

  it.each([
    { action: 'save', method: 'PATCH', path: '/api/music/playlists/second', reset: true },
    { action: 'import', method: 'POST', path: '/api/music/playlists/import/spotify', reset: true },
    {
      action: 'add',
      method: 'POST',
      path: '/api/music/playlists/second/tracks/spotify',
      reset: false,
    },
    {
      action: 'remove',
      method: 'DELETE',
      path: '/api/music/playlists/second/tracks/one',
      reset: false,
    },
    {
      action: 'reorder',
      method: 'PUT',
      path: '/api/music/playlists/second/tracks/order',
      reset: false,
    },
    {
      action: 'sync',
      method: 'POST',
      path: '/api/music/playlists/second/sync-links',
      reset: false,
    },
    { action: 'delete', method: 'DELETE', path: '/api/music/playlists/second', reset: true },
  ] satisfies ReadonlyArray<{
    action: 'save' | 'import' | 'add' | 'remove' | 'reorder' | 'sync' | 'delete'
    method: string
    path: string
    reset: boolean
  }>)(
    '$action uses the existing API, refreshes results and preserves unsaved fields when appropriate',
    async (item) => {
      const requests: Array<DashboardRequest> = []

      const service = Layer.succeed(DashboardService, {
        request: (request: DashboardRequest) =>
          Effect.sync(() => {
            requests.push(request)

            if (!request.method || request.method === 'GET')
              return { ...emptyDocument, playlists: [playlist], playlistTracks: tracks }

            if (item.action === 'import')
              return {
                ...emptyDocument,
                playlistImport: {
                  status: 'Imported',
                  playlistId: playlist.id,
                  trackCount: 2,
                  createdTrackCount: 1,
                  reusedTrackCount: 1,
                  enrichmentStatus: 'Unavailable',
                },
              }

            return emptyDocument
          }),
        readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
        writePlayerPreferences: () => Effect.void,
      })

      const live = Layer.mergeAll(WriteLibrary.layer, ReadDashboard.layer).pipe(
        Layer.provide(service),
      )

      await runWithLayer(
        Layer.merge(live, TestHost.layer()),
        Effect.gen(function* () {
          const root = yield* TestHost.mount(DashboardLibraryNoDeps, {
            principal,
            section: 'playlists',
            initialDocument: { ...emptyDocument, playlists: [playlist] },
          })

          root.send(LibraryMessage.ClickedEdit({ id: playlist.id }))
          yield* TestHost.settle
          root.send(LibraryMessage.UpdatedField({ name: 'title', value: 'Unsaved' }))
          root.send(
            LibraryMessage.UpdatedField({
              name: 'importUrl',
              value: 'https://open.spotify.com/playlist/fixture',
            }),
          )
          root.send(
            LibraryMessage.UpdatedField({
              name: 'trackUrl',
              value: 'https://open.spotify.com/track/fixture',
            }),
          )

          if (item.action === 'delete') root.send(LibraryMessage.ClickedDelete())

          if (item.action === 'reorder')
            root.send(LibraryMessage.ClickedMove({ id: 'two', direction: 'up' }))
          else root.send(LibraryMessage.ClickedAction({ action: item.action, trackId: 'one' }))
          yield* TestHost.settle
          const write = requests.find((request) => request.method && request.method !== 'GET')
          expect(write).toMatchObject({ method: item.method, path: item.path })
          expect(
            requests.filter((request) => request.method && request.method !== 'GET'),
          ).toHaveLength(1)

          if (item.action === 'reorder')
            expect(write?.body).toBe(JSON.stringify({ trackIds: ['two', 'one'] }))
          expect(requests.some((request) => request.path === '/api/music/playlists')).toBe(true)

          if (item.action !== 'delete')
            expect(
              requests.filter((request) => request.path.endsWith('/tracks')).length,
            ).toBeGreaterThanOrEqual(2)

          if (!item.reset) expect(root.model()?.fields.title).toBe('Unsaved')

          if (item.action === 'import') {
            expect(root.text()).toContain('Link enrichment unavailable; tracks were imported.')
            expect(root.model()?.selected).toBe(playlist.id)
          }

          expect(root.model()?.busy).toBe(false)
        }),
      )
    },
  )

  it('locks submitted fields, duplicate writes, selection and navigation, preserving failure retry input', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardLibraryNoDeps, {
            principal,
            section: 'playlists',
            initialDocument: { ...emptyDocument, playlists: [playlist] },
          })

          s.send(LibraryMessage.ClickedEdit({ id: playlist.id })).loaded('tracks', {
            ...emptyDocument,
            playlistTracks: tracks,
          })
          s.send(LibraryMessage.UpdatedField({ name: 'title', value: 'Unsaved' }))
          s.send(LibraryMessage.ClickedDelete())
          s.send(LibraryMessage.ClickedAction({ action: 'delete', trackId: '' }))
          const submitted = s.model

          const command = WriteLibrary.make({
            section: 'playlists',
            action: 'delete',
            selected: playlist.id,
            fields: submitted.fields,
            draft: true,
            trackId: '',
            trackIds: [],
          })

          s.expectExact(command).keepPending(command)

          for (const message of [
            LibraryMessage.ClickedNew(),
            LibraryMessage.ClickedBack(),
            LibraryMessage.ClickedEdit({ id: 'missing' }),
            LibraryMessage.ClickedCancelDelete(),
            LibraryMessage.ToggledDraft(),
            LibraryMessage.ClickedRefresh({ offset: 25 }),
            LibraryMessage.UpdatedField({ name: 'title', value: 'Ignored' }),
            LibraryMessage.ClickedAction({ action: 'save', trackId: '' }),
          ]) {
            s.send(message).expectExact(command).keepPending(command)
            expect(s.model).toEqual(submitted)
          }

          s.resolve(WriteLibrary, LibraryMessage.FailedWrite({ message: 'Unavailable' }))
          expect(s.model.fields.title).toBe('Unsaved')
          expect(s.model.confirming).toBe(true)
          expect(s.model.selected).toBe(playlist.id)
          s.send(LibraryMessage.ClickedAction({ action: 'delete', trackId: '' }))
            .expectExact(
              WriteLibrary.make({
                section: 'playlists',
                action: 'delete',
                selected: playlist.id,
                fields: submitted.fields,
                draft: true,
                trackId: '',
                trackIds: [],
              }),
            )
            .resolve(WriteLibrary, LibraryMessage.FailedWrite({ message: 'Still unavailable' }))
        }),
      ),
    ))

  it('rejects missing selection, unobserved removal and out-of-bounds track moves', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardLibraryNoDeps, {
            principal,
            section: 'playlists',
            initialDocument: { ...emptyDocument, playlists: [playlist] },
          })

          s.send(LibraryMessage.ClickedEdit({ id: 'missing' })).expectNone()
          expect(s.model.selected).toBeNull()
          s.send(
            LibraryMessage.ClickedAction({ action: 'remove', trackId: 'missing' }),
          ).expectNone()
          s.send(LibraryMessage.ClickedEdit({ id: playlist.id })).loaded('tracks', {
            ...emptyDocument,
            playlistTracks: tracks,
          })

          for (const message of [
            LibraryMessage.ClickedMove({ id: 'one', direction: 'up' }),
            LibraryMessage.ClickedMove({ id: 'two', direction: 'down' }),
            LibraryMessage.ClickedMove({ id: 'missing', direction: 'up' }),
            LibraryMessage.ClickedAction({ action: 'remove', trackId: 'missing' }),
          ])
            s.send(message).expectNone()
          expect(s.model.busy).toBe(false)
        }),
      ),
    ))

  it('opens and clears a new editor on demand and returns to the list', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(DashboardLibraryNoDeps, {
            principal,
            section: 'playlists',
            initialDocument: emptyDocument,
          })

          expect(s.model.editor).toBe(false)
          s.send(LibraryMessage.ClickedNew()).expectNone()
          s.send(LibraryMessage.UpdatedField({ name: 'title', value: 'Stale' })).expectNone()
          s.send(LibraryMessage.ClickedBack()).expectNone()
          expect(s.model.editor).toBe(false)
          s.send(LibraryMessage.ClickedNew()).expectNone()
          expect(s.model.fields.title).toBe('')
          expect(s.model.selected).toBeNull()
        }),
      ),
    ))
})
