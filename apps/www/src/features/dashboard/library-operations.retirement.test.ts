import { Locator, Scene, Story, TestHost } from '@effect/ui/testing'
import { Deferred, Effect, Layer, Predicate } from 'effect'
import { expect, it } from 'vitest'

import { runWithLayer } from '../player/testing'
import { type DashboardDocument, emptyDocument } from './document'
import { DashboardLibraryNoDeps, LibraryMessage, WriteLibrary } from './library'
import {
  type DashboardRequestError,
  DashboardService,
  ReadDashboard,
  type DashboardRequest,
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
    title: id,
    revision: 0,
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

const initial: DashboardDocument = {
  ...emptyDocument,
  playlists: [playlist],
  playlistTracks: tracks,
}

const operations = [
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
  { action: 'sync', method: 'POST', path: '/api/music/playlists/second/sync-links', reset: false },
  { action: 'delete', method: 'DELETE', path: '/api/music/playlists/second', reset: true },
] satisfies ReadonlyArray<{
  action: 'save' | 'import' | 'add' | 'remove' | 'reorder' | 'sync' | 'delete'
  method: string
  path: string
  reset: boolean
}>

it.each(operations)(
  '$action rejects its exact duplicate and Back while pending, then adopts the exact loaded listing/tracks/form',
  async (item) => {
    const write = Deferred.makeUnsafe<DashboardDocument, DashboardRequestError>()
    const requests: Array<DashboardRequest> = []
    let deleted = false
    let completedWrite = false
    const loadedPlaylist = { ...playlist, title: 'Loaded server playlist' }

    const loadedTracks = tracks.map((entry) => ({
      ...entry,
      track: { ...entry.track, title: `Loaded ${entry.track.title}` },
    }))

    const service = Layer.succeed(DashboardService, {
      request: (request: DashboardRequest) => {
        requests.push(request)

        if (request.method && request.method !== 'GET') return Deferred.await(write)

        if (request.path === '/api/music/playlists')
          return Effect.succeed({ ...emptyDocument, playlists: deleted ? [] : [loadedPlaylist] })

        if (request.path === '/api/music/playlists/second/tracks')
          return Effect.succeed({
            ...emptyDocument,
            playlistTracks: completedWrite ? loadedTracks : tracks,
          })

        return Effect.die('Unexpected native reload path')
      },
      readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
      writePlayerPreferences: () => Effect.void,
    })

    await runWithLayer(
      Layer.merge(
        TestHost.layer(),
        Layer.mergeAll(WriteLibrary.layer, ReadDashboard.layer).pipe(Layer.provide(service)),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(DashboardLibraryNoDeps, {
          principal,
          section: 'playlists',
          initialDocument: initial,
        })

        root.send(LibraryMessage.ClickedEdit({ id: playlist.id }))
        yield* TestHost.settle
        root.send(LibraryMessage.UpdatedField({ name: 'title', value: 'Unsaved' }))
        root.send(LibraryMessage.UpdatedField({ name: 'slug', value: 'unsaved' }))
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
        root.send(LibraryMessage.ClickedDelete())

        const trigger = () => {
          if (item.action === 'reorder')
            root.send(LibraryMessage.ClickedMove({ id: 'two', direction: 'up' }))
          else root.send(LibraryMessage.ClickedAction({ action: item.action, trackId: 'one' }))
        }

        trigger()
        yield* TestHost.settle
        const submitted = root.model()
        expect(submitted?.operation).toBe(item.action)
        expect(submitted?.busy).toBe(true)
        trigger()
        root.send(LibraryMessage.ClickedBack())
        yield* TestHost.settle
        expect(root.model()).toEqual(submitted)
        const writes = requests.filter((request) => request.method && request.method !== 'GET')
        expect(writes).toHaveLength(1)
        expect(writes[0]).toMatchObject({ path: item.path, method: item.method })

        if (item.action === 'reorder')
          expect(writes[0]?.body).toBe(JSON.stringify({ trackIds: ['two', 'one'] }))
        const readStart = requests.length
        deleted = item.action === 'delete'
        completedWrite = true

        const response: DashboardDocument =
          item.action === 'import'
            ? {
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
            : emptyDocument

        yield* Deferred.succeed(write, response)
        yield* TestHost.settle
        expect(
          requests
            .slice(readStart)
            .map(({ path }) => path)
            .sort(),
        ).toEqual(
          deleted
            ? ['/api/music/playlists']
            : ['/api/music/playlists', '/api/music/playlists/second/tracks'],
        )
        const state = root.model()
        expect(state?.busy).toBe(false)
        expect(state?.operation).toBeNull()
        expect(state?.confirming).toBe(false)

        if (deleted) {
          expect(state?.selected).toBeNull()
          expect(state?.editor).toBe(false)
          expect(state?.fields.title).toBe('')
          const rows = root.all(Locator.attr('class', 'admin-row'))
          expect(rows).toHaveLength(0)
          expect(root.query(Locator.attr('aria-label', 'Playlist tracks'))).toBeUndefined()
          expect(root.text()).not.toContain('Second playlist')
          root.send(LibraryMessage.ClickedEdit({ id: playlist.id }))
          yield* TestHost.settle
          expect(root.model()?.editor).toBe(false)
          expect(root.model()?.selected).toBeNull()
        } else {
          expect(state?.selected).toBe(playlist.id)
          expect(state?.editor).toBe(true)
          expect(state?.fields.title).toBe(item.reset ? 'Loaded server playlist' : 'Unsaved')
          expect(root.text()).toContain('Loaded one')
          expect(root.text()).toContain('Loaded two')

          if (item.action === 'import')
            expect(root.text()).toContain('Link enrichment unavailable; tracks were imported.')
        }

        expect(root.query(Locator.text('Confirm delete playlist', { exact: true }))).toBeUndefined()

        if (item.action === 'save' || item.action === 'import') {
          const input = root.get(Locator.attr('name', 'title'))

          if (!Predicate.isTagged(input, 'Element')) throw new Error('Missing loaded title input')
          expect(input.props.value).toBe('Loaded server playlist')
        }

        if (!deleted) {
          root.send(LibraryMessage.ClickedBack())
          yield* TestHost.settle
          expect(root.model()?.editor).toBe(false)
          expect(root.text()).toContain('Loaded server playlist')
          expect(root.text()).not.toContain('Second playlist')
          expect(root.all(Locator.attr('class', 'admin-row'))).toHaveLength(1)
        }
      }),
    )
  },
)

it('playlist deletion requires an existing selection and cancellable confirmation, with no service DELETE before confirmation', async () => {
  const requests: Array<DashboardRequest> = []

  const service = Layer.succeed(DashboardService, {
    request: (request: DashboardRequest) => {
      requests.push(request)

      return Effect.succeed(initial)
    },
    readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
    writePlayerPreferences: () => Effect.void,
  })

  await runWithLayer(
    Layer.merge(
      TestHost.layer(),
      Layer.mergeAll(WriteLibrary.layer, ReadDashboard.layer).pipe(Layer.provide(service)),
    ),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(DashboardLibraryNoDeps, {
        principal,
        section: 'playlists',
        initialDocument: initial,
      })

      root.send(LibraryMessage.ClickedAction({ action: 'delete', trackId: '' }))
      root.send(LibraryMessage.ClickedEdit({ id: playlist.id }))
      yield* TestHost.settle
      root.send(LibraryMessage.ClickedAction({ action: 'delete', trackId: '' }))
      root.send(LibraryMessage.ClickedDelete())
      yield* TestHost.settle
      expect(root.get(Locator.text('Confirm delete playlist', { exact: true }))).toBeDefined()
      expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(0)
      root.send(LibraryMessage.ClickedCancelDelete())
      root.send(LibraryMessage.ClickedAction({ action: 'delete', trackId: '' }))
      yield* TestHost.settle
      expect(root.model()?.selected).toBe(playlist.id)
      expect(root.model()?.editor).toBe(true)
      expect(root.query(Locator.text('Confirm delete playlist', { exact: true }))).toBeUndefined()
      expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(0)
      root.send(LibraryMessage.ClickedDelete())
      root.send(LibraryMessage.ClickedAction({ action: 'delete', trackId: '' }))
      yield* TestHost.settle
      expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1)
    }),
  )
})

it.each(['user', 'creator', 'editor'])(
  'forged playlist Import performs zero service writes for non-admin %s',
  async (role) => {
    const requests: Array<DashboardRequest> = []

    const service = Layer.succeed(DashboardService, {
      request: (request: DashboardRequest) => {
        requests.push(request)

        return Effect.succeed(initial)
      },
      readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
      writePlayerPreferences: () => Effect.void,
    })

    await runWithLayer(
      Layer.merge(
        TestHost.layer(),
        Layer.mergeAll(WriteLibrary.layer, ReadDashboard.layer).pipe(Layer.provide(service)),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(DashboardLibraryNoDeps, {
          principal: { ...principal, role },
          section: 'playlists',
          initialDocument: initial,
        })

        root.send(
          LibraryMessage.UpdatedField({
            name: 'importUrl',
            value: 'https://open.spotify.com/playlist/fixture',
          }),
        )
        root.send(LibraryMessage.ClickedAction({ action: 'import', trackId: '' }))
        yield* TestHost.settle
        expect(requests).toEqual([])
        expect(root.model()?.busy).toBe(false)
      }),
    )
  },
)

it('a new playlist retains the listing, Back closes it, and saving without a selected ID returns to the list', async () => {
  const requests: Array<DashboardRequest> = []

  const service = Layer.succeed(DashboardService, {
    request: (request: DashboardRequest) => {
      requests.push(request)

      return Effect.succeed(initial)
    },
    readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
    writePlayerPreferences: () => Effect.void,
  })

  await runWithLayer(
    Layer.merge(
      TestHost.layer(),
      Layer.mergeAll(WriteLibrary.layer, ReadDashboard.layer).pipe(Layer.provide(service)),
    ),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(DashboardLibraryNoDeps, {
        principal,
        section: 'playlists',
        initialDocument: initial,
      })

      root.send(LibraryMessage.ClickedNew())
      expect(root.model()?.editor).toBe(true)
      expect(root.model()?.selected).toBeNull()
      root.send(LibraryMessage.ClickedBack())
      expect(root.model()?.editor).toBe(false)
      expect(root.text()).toContain(playlist.title)
      expect(requests).toEqual([])
      root.send(LibraryMessage.ClickedNew())
      root.send(LibraryMessage.UpdatedField({ name: 'title', value: 'New playlist' }))
      root.send(LibraryMessage.UpdatedField({ name: 'slug', value: 'new-playlist' }))
      root.send(LibraryMessage.ClickedAction({ action: 'save', trackId: '' }))
      yield* TestHost.settle
      expect(requests[0]).toMatchObject({ path: '/api/music/playlists', method: 'POST' })
      expect(root.model()?.editor).toBe(false)
      expect(root.model()?.selected).toBeNull()
      expect(root.text()).toContain(playlist.title)
    }),
  )
})

it.each([false, true])(
  'show rendered submit branches across idle/loading/save/delete, editing=%s',
  (editing) => {
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const props = { principal, section: 'shows', initialDocument: emptyDocument }
          const seed = yield* Story.make(DashboardLibraryNoDeps, props)
          const scene = yield* Scene.make(DashboardLibraryNoDeps, props)

          for (const operation of [null, 'load', 'save', 'delete'] satisfies ReadonlyArray<
            null | 'load' | 'save' | 'delete'
          >) {
            scene.given({
              ...seed.model,
              editor: true,
              selected: editing ? 'show' : null,
              operation,
              busy: operation !== null,
            })
            let label = editing ? 'Save changes' : 'Create show'

            if (operation === 'save') label = 'Saving'
            const button = scene.current.query(Locator.text(label, { exact: true }))
            expect(
              button,
              `${editing ? 'Editing' : 'Creating'}/${operation ?? 'idle'}`,
            ).toBeDefined()
            expect(button?.tag).toBe('button')
            expect(button?.attrs?.disabled).toBe(operation === null ? undefined : '')

            for (const other of ['Saving', 'Save changes', 'Create show'].filter(
              (value) => value !== label,
            ))
              expect(scene.current.query(Locator.text(other, { exact: true }))).toBeUndefined()
          }
        }),
      ),
    )
  },
)
