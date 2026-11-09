import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  decodePlaylistCommand,
  type LocalPlaylistCommand,
  playlistCommandScopes,
  PreviewPlaylistChanges,
} from './contracts'
import { planPlaylistChanges, type PlaylistState } from './planner'

const requestId = '8c1edf8f-17fe-467a-af3e-f5f94853de83'

const target = { requestId, playlistId: 'playlist-a', expectedRevision: 7 }

const now = 123_000

const snapshot: PlaylistState = {
  playlistId: target.playlistId,
  revision: 7,
  metadata: { title: 'Original', slug: 'original', description: 'Keep me', coverImageUrl: null },
  publishedAt: null,
  members: [
    { trackId: 'z', position: 8, addedAt: 20 },
    { trackId: 'b', position: 2, addedAt: 10 },
    { trackId: 'a', position: 2, addedAt: 15 },
  ],
}

const plan = (command: LocalPlaylistCommand, state: PlaylistState | null = snapshot) =>
  Effect.runPromise(
    planPlaylistChanges({
      command,
      snapshot: state,
      now,
      catalogueTrackIds: new Set(['a', 'b', 'z', 'new']),
    }),
  )

describe('playlist desired-state contract (not a command executor)', () => {
  it('appends existing IDs only, preserves gaps/ties/dates and never moves an existing member', async () => {
    const result = await plan({
      operation: 'add_playlist_tracks',
      ...target,
      trackIds: ['b', 'new'],
    })

    expect(result.after.members).toEqual([
      { trackId: 'a', position: 2, addedAt: 15 },
      { trackId: 'b', position: 2, addedAt: 10 },
      { trackId: 'z', position: 8, addedAt: 20 },
      { trackId: 'new', position: 9, addedAt: now },
    ])
    expect(result.revision).toBe(8)
    expect(snapshot.members[0]?.trackId).toBe('z')
    await expect(
      plan({ operation: 'add_playlist_tracks', ...target, trackIds: ['absent'] }),
    ).rejects.toHaveProperty('_tag', 'ValidationError')

    const removed = await plan({
      operation: 'remove_playlist_tracks',
      ...target,
      trackIds: ['b', 'absent'],
    })

    expect(removed.after.members).toEqual([
      { trackId: 'a', position: 2, addedAt: 15 },
      { trackId: 'z', position: 8, addedAt: 20 },
    ])
  })

  it('requires a complete reorder, compacts positions and preserves membership creation times', async () => {
    const result = await plan({
      operation: 'reorder_playlist_tracks',
      ...target,
      trackIds: ['z', 'a', 'b'],
    })

    expect(result.after.members).toEqual([
      { trackId: 'z', position: 0, addedAt: 20 },
      { trackId: 'a', position: 1, addedAt: 15 },
      { trackId: 'b', position: 2, addedAt: 10 },
    ])

    for (const trackIds of [
      ['a', 'b'],
      ['a', 'b', 'absent'],
      ['a', 'a', 'z'],
    ]) {
      await expect(
        plan({ operation: 'reorder_playlist_tracks', ...target, trackIds }),
      ).rejects.toHaveProperty('_tag', 'ValidationError')
    }
  })

  it('preserves omitted metadata, clears explicit null, and cannot publish through metadata', async () => {
    const result = await plan({
      operation: 'update_playlist',
      ...target,
      metadata: { description: null },
    })

    expect(result.after.metadata).toEqual({ ...snapshot.metadata, description: null })
    expect(result.after.publishedAt).toBeNull()

    for (const payload of [
      { operation: 'update_playlist', ...target, metadata: { title: 'Sneak', publishedAt: now } },
      { operation: 'update_playlist', ...target, metadata: { title: 'Sneak' }, publishedAt: now },
      {
        operation: 'create_playlist',
        requestId,
        metadata: snapshot.metadata,
        createdById: 'someone',
      },
      { operation: 'update_playlist', ...target, metadata: {} },
    ]) {
      await expect(Effect.runPromise(decodePlaylistCommand(payload))).rejects.toBeDefined()
    }

    const created = await plan(
      { operation: 'create_playlist', requestId, metadata: snapshot.metadata },
      null,
    )

    expect(created).toMatchObject({
      playlistId: null,
      revision: 0,
      after: { publishedAt: null, members: [] },
    })
  })

  it('publishes at the captured instant, leaves public no-ops unchanged and unpublishes explicitly', async () => {
    const command = { operation: 'publish_playlist', ...target } as const
    expect((await plan(command)).after.publishedAt).toBe(now)
    expect((await plan(command, { ...snapshot, publishedAt: now + 1 })).after.publishedAt).toBe(now)
    const already = await plan(command, { ...snapshot, publishedAt: now })
    expect(already).toMatchObject({ changed: false, revision: 7, after: { publishedAt: now } })
    expect(
      await plan(
        { operation: 'unpublish_playlist', ...target },
        { ...snapshot, publishedAt: now - 1 },
      ),
    ).toMatchObject({ changed: true, revision: 8, after: { publishedAt: null } })
  })

  it('checks stale revisions even for no-ops and rejects revision/position/size overflow', async () => {
    await expect(
      plan({ operation: 'unpublish_playlist', ...target, expectedRevision: 6 }),
    ).rejects.toHaveProperty('_tag', 'ConflictError')
    const exhausted = { ...snapshot, revision: Number.MAX_SAFE_INTEGER }
    expect(
      await plan(
        { operation: 'unpublish_playlist', ...target, expectedRevision: exhausted.revision },
        exhausted,
      ),
    ).toMatchObject({ changed: false, revision: Number.MAX_SAFE_INTEGER })
    await expect(
      plan(
        { operation: 'publish_playlist', ...target, expectedRevision: exhausted.revision },
        exhausted,
      ),
    ).rejects.toHaveProperty('_tag', 'ValidationError')
    await expect(
      plan(
        { operation: 'add_playlist_tracks', ...target, trackIds: ['new'] },
        {
          ...snapshot,
          members: [{ trackId: 'a', position: Number.MAX_SAFE_INTEGER, addedAt: 10 }],
        },
      ),
    ).rejects.toHaveProperty('_tag', 'ValidationError')

    const full = {
      ...snapshot,
      members: Array.from({ length: 500 }, (_, i) => ({
        trackId: `t${i}`,
        position: i,
        addedAt: 10,
      })),
    }

    await expect(
      plan({ operation: 'add_playlist_tracks', ...target, trackIds: ['new'] }, full),
    ).rejects.toHaveProperty('_tag', 'ValidationError')
  })

  it('retains selected provider/preview contracts without granting publication/import via curation', async () => {
    for (const operation of ['add_playlist_track_from_url', 'sync_playlist_links'] as const) {
      const command = await Effect.runPromise(
        decodePlaylistCommand(
          operation === 'add_playlist_track_from_url'
            ? { operation, ...target, url: 'https://open.spotify.com/track/existing' }
            : { operation, ...target },
        ),
      )

      expect(playlistCommandScopes(command)).toEqual([
        'playlists:write',
        'catalogue:write',
        'catalogue:import',
        'providers:read',
      ])

      const preview = Schema.decodeUnknownSync(PreviewPlaylistChanges)({
        operation: 'preview_playlist_changes',
        command,
      })

      expect(preview.command).toEqual(command)
    }

    expect(playlistCommandScopes({ operation: 'publish_playlist', ...target })).toEqual([
      'playlists:write',
      'playlists:publish',
    ])
    expect(
      playlistCommandScopes({
        operation: 'update_playlist',
        ...target,
        metadata: { title: 'New' },
      }),
    ).toEqual(['playlists:write'])

    for (const url of ['javascript:alert(1)', 'https://user:secret@example.test/track']) {
      await expect(
        Effect.runPromise(
          decodePlaylistCommand({ operation: 'add_playlist_track_from_url', ...target, url }),
        ),
      ).rejects.toBeDefined()
    }
  })
})
