import type { PlaylistResponse } from '@gbfm/api/music'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import * as Dashboard from '..'
import { emptyDocument } from '../document'
import { DashboardRequestError, DashboardService, type DashboardRequest } from '../service'
import { initialModel, Message, Model, update } from './playlists'

const playlist: PlaylistResponse = {
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

describe('playlist editing', () => {
  it('keeps imported tracks successful when link enrichment is unavailable', async () => {
    const model = { ...initialModel, importUrl: 'https://open.spotify.com/playlist/fixture' }
    const pending = update(model, Message.Import())
    const command = pending.commands?.[0]

    if (!command) throw new Error('Expected import command')

    const result = await Effect.runPromise(
      command.effect.pipe(
        Effect.provideService(DashboardService, {
          request: () =>
            Effect.succeed({
              ...emptyDocument,
              playlistImport: {
                status: 'Imported',
                playlistId: playlist.id,
                trackCount: 2,
                createdTrackCount: 1,
                reusedTrackCount: 1,
                enrichmentStatus: 'Unavailable',
              },
            }),
          readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
          writePlayerPreferences: () => Effect.void,
        }),
      ),
    )

    const saved = update(pending.model, result)
    expect(saved.model.editor).toEqual(Model.fields.editor.cases.Editing.make({ id: playlist.id }))
    expect(saved.model.notice).toContain('Link enrichment unavailable; tracks were imported.')
    expect(saved.commands?.[0]?.args).toMatchObject({ selected: playlist.id, resetForm: true })
  })

  const tracks = ['one', 'two'].map((id, position) => ({
    track: {
      id,
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

  it('identifies each write, locks duplicates, reloads results and preserves unsaved fields for track operations', async () => {
    const ready = {
      ...initialModel,
      editor: Model.fields.editor.cases.Editing.make({ id: playlist.id }),
      listing: [playlist],
      tracks,
      form: { ...initialModel.form, title: 'Unsaved', slug: 'unsaved' },
      importUrl: 'https://open.spotify.com/playlist/fixture',
      trackUrl: 'https://open.spotify.com/track/fixture',
    }

    const cases = [
      {
        action: 'save',
        message: Message.Save(),
        method: 'PATCH',
        path: '/api/music/playlists/second',
        reset: true,
      },
      {
        action: 'import',
        message: Message.Import(),
        method: 'POST',
        path: '/api/music/playlists/import/spotify',
        reset: true,
      },
      {
        action: 'add',
        message: Message.AddTrack(),
        method: 'POST',
        path: '/api/music/playlists/second/tracks/spotify',
        reset: false,
      },
      {
        action: 'remove',
        message: Message.RemoveTrack({ id: 'one' }),
        method: 'DELETE',
        path: '/api/music/playlists/second/tracks/one',
        reset: false,
      },
      {
        action: 'reorder',
        message: Message.MoveTrack({ id: 'two', direction: 'up' }),
        method: 'PUT',
        path: '/api/music/playlists/second/tracks/order',
        reset: false,
      },
      {
        action: 'sync',
        message: Message.Sync(),
        method: 'POST',
        path: '/api/music/playlists/second/sync-links',
        reset: false,
      },
      {
        action: 'delete',
        message: Message.ConfirmDelete(),
        method: 'DELETE',
        path: '/api/music/playlists/second',
        reset: true,
      },
    ]

    for (const item of cases) {
      const requests: Array<DashboardRequest> = []

      const service = DashboardService.of({
        request: (request) =>
          Effect.sync(() => {
            requests.push(request)

            if (request.method)
              return {
                ...emptyDocument,
                playlistImport:
                  item.action === 'import'
                    ? {
                        status: 'Imported',
                        playlistId: playlist.id,
                        trackCount: 2,
                        createdTrackCount: 2,
                        reusedTrackCount: 0,
                        enrichmentStatus: 'Unavailable',
                      }
                    : undefined,
              }

            if (request.path === '/api/music/playlists')
              return { ...emptyDocument, playlists: item.action === 'delete' ? [] : [playlist] }

            if (request.path === '/api/music/playlists/second/tracks')
              return { ...emptyDocument, playlistTracks: tracks }

            throw new Error(`Unexpected reload path: ${request.path}`)
          }),
        readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
        writePlayerPreferences: () => Effect.void,
      })

      const pending = update({ ...ready, deleting: true }, item.message)
      expect(pending.model.operation).toBe(item.action)
      expect(update(pending.model, item.message).commands).toBeUndefined()
      expect(update(pending.model, Message.Back()).model).toBe(pending.model)
      const command = pending.commands?.[0]

      if (!command) throw new Error('Expected playlist command')

      const message = await Effect.runPromise(
        command.effect.pipe(Effect.provideService(DashboardService, service)),
      )

      expect(requests[0]?.method).toBe(item.method)
      expect(requests[0]?.path).toBe(item.path)

      expect(
        item.action !== 'reorder' ||
          requests[0]?.body === JSON.stringify({ trackIds: ['two', 'one'] }),
      ).toBe(true)
      const reload = update(pending.model, message)
      expect(reload.model.operation).toBe('loading')
      const load = reload.commands?.[0]

      if (!load) throw new Error('Expected playlist reload')

      const loaded = update(
        reload.model,
        await Effect.runPromise(load.effect.pipe(Effect.provideService(DashboardService, service))),
      ).model

      expect(requests.slice(1)).toEqual(
        item.action === 'delete'
          ? [{ path: '/api/music/playlists' }]
          : [{ path: '/api/music/playlists' }, { path: '/api/music/playlists/second/tracks' }],
      )
      expect(loaded.operation).toBe('idle')
      expect(loaded.listing).toEqual(item.action === 'delete' ? [] : [playlist])
      expect(loaded.tracks).toEqual(item.action === 'delete' ? [] : tracks)
      expect(loaded.form.title).toBe(
        item.reset ? (item.action === 'delete' ? '' : playlist.title) : 'Unsaved',
      )
      expect(loaded.deleting).toBe(false)
    }
  })

  it('keeps the selected editor and confirmation after an operation error for retry', async () => {
    const model = {
      ...initialModel,
      editor: Model.fields.editor.cases.Editing.make({ id: playlist.id }),
      deleting: true,
    }

    const pending = update(model, Message.ConfirmDelete())
    const command = pending.commands?.[0]

    if (!command) throw new Error('Expected delete command')

    const message = await Effect.runPromise(
      command.effect.pipe(
        Effect.provideService(DashboardService, {
          request: () =>
            Effect.fail(new DashboardRequestError({ status: 503, message: 'Unavailable' })),
          readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
          writePlayerPreferences: () => Effect.void,
        }),
      ),
    )

    const failed = update(pending.model, message).model
    expect(failed.editor).toEqual(model.editor)
    expect(failed.deleting).toBe(true)
    expect(failed.operation).toBe('idle')
    expect(update(failed, Message.ConfirmDelete()).commands).toHaveLength(1)
  })

  it('rejects missing selections and invalid track moves while preserving a stale selection after reload', () => {
    expect(update(initialModel, Message.Select({ id: 'missing' })).model).toBe(initialModel)
    expect(update(initialModel, Message.RemoveTrack({ id: 'missing' })).commands).toBeUndefined()

    const model = {
      ...initialModel,
      editor: Model.fields.editor.cases.Editing.make({ id: playlist.id }),
      tracks,
    }

    for (const message of [
      Message.MoveTrack({ id: 'one', direction: 'up' }),
      Message.MoveTrack({ id: 'two', direction: 'down' }),
      Message.MoveTrack({ id: 'missing', direction: 'up' }),
    ])
      expect(update(model, message).commands).toBeUndefined()
    const stale = update(model, Message.Loaded({ listing: [], tracks: [], resetForm: true })).model
    expect(stale.editor).toEqual(model.editor)
    expect(stale.form).toEqual(initialModel.form)
  })

  it('does not save the previous playlist form after selecting a playlist whose tracks fail to load', () => {
    const previous = {
      ...initialModel,
      editor: Model.fields.editor.cases.Editing.make({ id: 'first' }),
      listing: [playlist],
      form: { ...initialModel.form, title: 'Unsaved first playlist', slug: 'first' },
    }

    const selected = update(previous, Message.Select({ id: playlist.id }))
    expect(update(selected.model, Message.New()).model).toBe(selected.model)
    const failed = update(selected.model, Message.Failed({ message: 'Tracks unavailable' }))
    expect(failed.model.form).toMatchObject({ title: 'Second playlist', slug: 'second-playlist' })
    expect(failed.model.editor).toEqual(Model.fields.editor.cases.Editing.make({ id: 'second' }))
    expect(failed.model.tracks).toEqual([])
    const saving = update(failed.model, Message.Save())
    expect(saving.commands?.[0]?.args).toMatchObject({
      selected: 'second',
      form: { title: 'Second playlist' },
    })
  })

  it('requires confirmation for deletion and admin access for playlist commands', () => {
    const model = {
      ...initialModel,
      editor: Model.fields.editor.cases.Editing.make({ id: playlist.id }),
    }

    expect(update(model, Message.ConfirmDelete()).commands).toBeUndefined()
    const asking = update(model, Message.AskDelete())
    expect(update(asking.model, Message.ConfirmDelete()).commands).toHaveLength(1)
    const canceled = update(asking.model, Message.CancelDelete())
    expect(update(canceled.model, Message.ConfirmDelete()).commands).toBeUndefined()
    const member = Dashboard.initialModel('playlists', { id: 'member', role: 'user' })
    expect(
      Dashboard.update(member, Dashboard.Message.GotPlaylistMessage({ message: Message.Import() }))
        .commands,
    ).toBeUndefined()
  })

  it('opens a new playlist form on demand and returns to the list', () => {
    const creating = update({ ...initialModel, listing: [playlist] }, Message.New()).model
    expect(Model.fields.editor.guards.Creating(creating.editor)).toBe(true)
    expect(creating.listing).toEqual([playlist])
    expect(update(creating, Message.Back()).model.editor).toEqual(initialModel.editor)

    const saved = update(
      creating,
      Message.Saved({ selected: null, notice: 'Playlist changes saved.', resetForm: true }),
    ).model

    expect(saved.editor).toEqual(initialModel.editor)
  })
})
