import { and, eq, inArray, sql } from 'drizzle-orm'
import { Effect, Exit, Result } from 'effect'

import { Database } from '@/db/layer'
import {
  musicEntityLinksTable,
  musicPlaylistsTable,
  musicPlaylistTracksTable,
  musicTracksTable,
  type SelectMusicEntityLink,
} from '@/db/music-entity.schema'
import { DatabaseError, getErrorMessage, MusicProviderInvalidInput } from '@/errors'
import type { CanonicalMusicIdentityService } from '@/services/canonical-music-identity'
import type { MusicIdentityError } from '@/services/canonical-music-identity/errors'
import { getSafeErrorTag } from '@/services/canonical-music-identity/telemetry'
import {
  getIdFromSpotifyUrl,
  type SpotifyImportPlaylist,
  type SpotifyImportTrack,
  type SpotifyService,
} from '@/services/spotify.service'

import { type ImportedTrackTarget, requireInserted } from './shared'

export interface PlaylistExecutionProgress {
  readonly phase: 'importing' | 'enriching'
  readonly processed: number
  readonly total: number | null
  readonly failed: number
}

// These hooks report real work; they are not durable acceptance, a SQL fence,
// or permission to reuse a cached grant. The caller owns persisted status.
export interface PlaylistExecutionHooks {
  readonly checkpoint: Effect.Effect<void, DatabaseError | MusicIdentityError>
  readonly progress: (
    progress: PlaylistExecutionProgress,
  ) => Effect.Effect<void, DatabaseError | MusicIdentityError>
}

export const getPlaylistTracksEffect = (playlistId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    return yield* Effect.tryPromise({
      try: async () => {
        const rows = await db
          .select({
            track: musicTracksTable,
            position: musicPlaylistTracksTable.position,
            addedAt: musicPlaylistTracksTable.addedAt,
          })
          .from(musicPlaylistTracksTable)
          .innerJoin(musicTracksTable, eq(musicPlaylistTracksTable.trackId, musicTracksTable.id))
          .where(eq(musicPlaylistTracksTable.playlistId, playlistId))
          .orderBy(musicPlaylistTracksTable.position, musicPlaylistTracksTable.trackId)

        const trackIds = rows.map((r) => r.track.id)

        const linkRows =
          trackIds.length === 0
            ? []
            : await db
                .select()
                .from(musicEntityLinksTable)
                .where(
                  and(
                    eq(musicEntityLinksTable.entityType, 'track'),
                    inArray(musicEntityLinksTable.entityId, trackIds),
                  ),
                )
                .orderBy(musicEntityLinksTable.platform, musicEntityLinksTable.url)

        const linksByTrackId = new Map<string, Array<SelectMusicEntityLink>>()

        for (const link of linkRows) {
          const list = linksByTrackId.get(link.entityId) ?? []
          list.push(link)
          linksByTrackId.set(link.entityId, list)
        }

        return rows.map((r) => ({
          ...r,
          links: linksByTrackId.get(r.track.id) ?? [],
        }))
      },
      catch: (e) =>
        new DatabaseError({
          message: `Failed to get playlist tracks: ${getErrorMessage(e)}`,
          operation: 'select',
          table: 'music_playlist_tracks',
        }),
    })
  }).pipe(
    Effect.withSpan('musicEntity.getPlaylistTracks', {
      attributes: { playlistId },
    }),
  )

export const addTrackToPlaylistEffect = Effect.fn('musicEntity.addTrackToPlaylist')(function* (
  playlistId: string,
  trackId: string,
  position: number,
) {
  const db = yield* Database

  const rows = yield* Effect.tryPromise({
    try: () =>
      db
        .insert(musicPlaylistTracksTable)
        .values({ playlistId, trackId, position })
        .onConflictDoUpdate({
          target: [musicPlaylistTracksTable.playlistId, musicPlaylistTracksTable.trackId],
          set: { position },
        })
        .returning(),
    catch: (e) =>
      new DatabaseError({
        message: `Failed to add track to playlist: ${getErrorMessage(e)}`,
        operation: 'insert',
        table: 'music_playlist_tracks',
      }),
  })

  return yield* requireInserted(rows, 'music_playlist_tracks')
})

export const removeTrackFromPlaylistEffect = (playlistId: string, trackId: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* Effect.tryPromise({
      try: () =>
        db
          .delete(musicPlaylistTracksTable)
          .where(
            and(
              eq(musicPlaylistTracksTable.playlistId, playlistId),
              eq(musicPlaylistTracksTable.trackId, trackId),
            ),
          ),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to remove track from playlist: ${getErrorMessage(e)}`,
          operation: 'delete',
          table: 'music_playlist_tracks',
        }),
    })
  }).pipe(
    Effect.withSpan('musicEntity.removeTrackFromPlaylist', {
      attributes: { playlistId, trackId },
    }),
  )

export const reorderPlaylistTracksEffect = (playlistId: string, trackIds: Array<string>) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* Effect.tryPromise({
      try: async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const playlistRows = await db
            .select({ revision: musicPlaylistsTable.revision })
            .from(musicPlaylistsTable)
            .where(eq(musicPlaylistsTable.id, playlistId))
            .limit(1)

          const playlist = playlistRows[0]

          if (!playlist) {
            throw new DatabaseError({
              message: 'Playlist not found',
              operation: 'update',
              table: 'music_playlists',
            })
          }

          const existing = await db
            .select({ trackId: musicPlaylistTracksTable.trackId })
            .from(musicPlaylistTracksTable)
            .where(eq(musicPlaylistTracksTable.playlistId, playlistId))

          const existingSet = new Set(existing.map((row) => row.trackId))
          const incomingSet = new Set(trackIds)

          if (
            existingSet.size !== incomingSet.size ||
            [...existingSet].some((trackId) => !incomingSet.has(trackId))
          ) {
            throw new DatabaseError({
              message: 'Reorder track set must match current playlist tracks exactly',
              operation: 'update',
              table: 'music_playlist_tracks',
            })
          }

          const revision = playlist.revision + 1

          const incoming = db
            .select({
              trackId: sql<string>`value`.as('track_id'),
              position: sql<number>`max(cast(key as integer))`.as('incoming_position'),
            })
            .from(sql`json_each(${JSON.stringify(trackIds)})`)
            .groupBy(sql`value`)
            .as('incoming')

          const [advanced] = await db.batch([
            db
              .update(musicPlaylistsTable)
              .set({ revision, updatedAt: new Date() })
              .where(
                and(
                  eq(musicPlaylistsTable.id, playlistId),
                  eq(musicPlaylistsTable.revision, playlist.revision),
                ),
              )
              .returning({ id: musicPlaylistsTable.id }),
            db
              .update(musicPlaylistTracksTable)
              .set({ position: sql`${incoming.position}` })
              .from(incoming)
              .where(
                and(
                  eq(musicPlaylistTracksTable.playlistId, playlistId),
                  eq(musicPlaylistTracksTable.trackId, incoming.trackId),
                  sql`changes() > 0`,
                ),
              ),
          ])

          if (advanced.length > 0) return
        }

        throw new DatabaseError({
          message: 'Playlist changed while reordering tracks',
          operation: 'update',
          table: 'music_playlist_tracks',
        })
      },
      catch: (e) =>
        e instanceof DatabaseError
          ? e
          : new DatabaseError({
              message: `Failed to reorder tracks: ${getErrorMessage(e)}`,
              operation: 'update',
              table: 'music_playlist_tracks',
            }),
    })
  }).pipe(
    Effect.withSpan('musicEntity.reorderPlaylistTracks', {
      attributes: { playlistId },
    }),
  )

const spotifyTrackSnapshot = (track: SpotifyImportTrack) => ({
  entityType: 'track' as const,
  sourceUrl: track.trackUrl,
  title: track.title,
  artistNames: track.artistNames,
  imageUrl: track.albumImageUrl ?? undefined,
  trackNumber: track.trackNumber ?? undefined,
  sourceMetadata: {
    spotifyTrackId: track.spotifyTrackId,
    durationMs: track.durationMs,
    previewUrl: track.previewUrl,
    albumName: track.albumName,
    albumSpotifyId: track.albumSpotifyId,
  },
})

const enrichTrackLinksEffect = (
  identity: CanonicalMusicIdentityService,
  playlistId: string,
  track: ImportedTrackTarget,
) =>
  Effect.gen(function* () {
    const refreshed = yield* identity.enrichEntity({
      entityType: 'track',
      entityId: track.trackId,
      actorId: 'playlist_enrichment',
      origin: 'playlist_enrichment',
      artworkDelivery: 'best_effort',
    })

    return { insertedCount: refreshed.links.filter((link) => link.platform !== 'spotify').length }
  }).pipe(
    Effect.withSpan('musicEntity.enrichTrackLinks', {
      attributes: { playlistId, trackId: track.trackId, artistCount: track.artistNames.length },
    }),
  )

const getExitErrorTag = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isSuccess(exit)) return undefined
  const error = Exit.findError(exit)

  return Result.isSuccess(error) ? getSafeErrorTag(error.success) : undefined
}

const enrichImportedPlaylistLinksEffect = (
  identity: CanonicalMusicIdentityService,
  playlistId: string,
  tracks: Array<ImportedTrackTarget>,
  execution?: PlaylistExecutionHooks,
) =>
  Effect.gen(function* () {
    const uniqueTracks = [...new Map(tracks.map((track) => [track.trackId, track])).values()]
    let processed = 0
    let failed = 0

    if (execution) {
      yield* execution.checkpoint
      yield* execution.progress({
        phase: 'enriching',
        processed,
        total: uniqueTracks.length,
        failed,
      })
    }

    const exits = yield* Effect.forEach(
      uniqueTracks,
      (track) =>
        Effect.gen(function* () {
          // Keep authority/status failures outside the item failure collector:
          // they stop the pass, rather than allowing later provider calls.
          if (execution) yield* execution.checkpoint
          const exit = yield* Effect.exit(enrichTrackLinksEffect(identity, playlistId, track))

          if (execution && Exit.hasInterrupts(exit)) return yield* Effect.failCause(exit.cause)
          processed += 1

          if (Exit.isFailure(exit)) {
            failed += 1
            yield* Effect.logWarning('[MusicEntity] Playlist track link enrichment failed', {
              playlistId,
              trackId: track.trackId,
              errorTag: getExitErrorTag(exit),
            })
          }

          if (execution)
            yield* execution.progress({
              phase: 'enriching',
              processed,
              total: uniqueTracks.length,
              failed,
            })

          return exit
        }),
      { concurrency: 1 },
    )

    const failure = exits.find(Exit.isFailure)

    if (failure) return yield* Effect.failCause(failure.cause)

    return {
      insertedCount: exits.reduce(
        (sum, exit) => sum + (Exit.isSuccess(exit) ? exit.value.insertedCount : 0),
        0,
      ),
    }
  }).pipe(
    Effect.withSpan('musicEntity.enrichImportedPlaylistLinks', {
      attributes: { playlistId, trackCount: tracks.length },
    }),
  )

const getPlaylistLinkSyncTargetsEffect = (playlistId: string) =>
  Effect.gen(function* () {
    const rows = yield* getPlaylistTracksEffect(playlistId)

    return rows.flatMap((row) => {
      const spotifyLink = row.links.find((link) => link.platform === 'spotify')

      if (!spotifyLink) return []

      return [
        {
          trackId: row.track.id,
          trackUrl: spotifyLink.url,
          title: row.track.title,
          artistNames: row.track.artistNames ?? [],
        } satisfies ImportedTrackTarget,
      ]
    })
  }).pipe(
    Effect.withSpan('musicEntity.getPlaylistLinkSyncTargets', {
      attributes: { playlistId },
    }),
  )

export const addSpotifyTrackToPlaylistEffect = (
  spotify: Pick<SpotifyService, 'getTrackForImport'>,
  identity: CanonicalMusicIdentityService,
) =>
  Effect.fn('musicEntity.addSpotifyTrackToPlaylist')(function* (
    playlistId: string,
    spotifyUrl: string,
  ) {
    const db = yield* Database
    const id = getIdFromSpotifyUrl(spotifyUrl)

    if (!id) {
      return yield* new MusicProviderInvalidInput({
        message: 'Could not extract Spotify track ID from URL',
        operation: 'addSpotifyTrackToPlaylist',
      })
    }

    const resolved = yield* identity.importProviderEntityLazy({
      entityType: 'track',
      sourceUrl: spotifyUrl,
      origin: 'spotify_import',
      artworkDelivery: 'preserve',
      loadSnapshot: Effect.suspend(() => spotify.getTrackForImport(id)).pipe(
        Effect.map(spotifyTrackSnapshot),
      ),
    })

    const track = { trackId: resolved.entity.id, created: resolved.created }

    return yield* Effect.tryPromise({
      try: async () => {
        await db.batch([
          db
            .insert(musicPlaylistTracksTable)
            .select(
              db
                .select({
                  playlistId: sql<string>`${playlistId}`.as('playlistId'),
                  trackId: sql<string>`${track.trackId}`.as('trackId'),
                  position:
                    sql<number>`coalesce(max(${musicPlaylistTracksTable.position}), -1) + 1`.as(
                      'position',
                    ),
                  addedAt: sql<Date>`${Date.now()}`.as('addedAt'),
                })
                .from(musicPlaylistsTable)
                .leftJoin(
                  musicPlaylistTracksTable,
                  eq(musicPlaylistTracksTable.playlistId, musicPlaylistsTable.id),
                )
                .where(eq(musicPlaylistsTable.id, playlistId))
                .groupBy(musicPlaylistsTable.id),
            )
            .onConflictDoNothing({
              target: [musicPlaylistTracksTable.playlistId, musicPlaylistTracksTable.trackId],
            }),
        ])

        const finalRows = await db
          .select({ position: musicPlaylistTracksTable.position })
          .from(musicPlaylistTracksTable)
          .where(
            and(
              eq(musicPlaylistTracksTable.playlistId, playlistId),
              eq(musicPlaylistTracksTable.trackId, track.trackId),
            ),
          )
          .limit(1)

        const final = finalRows[0]

        if (!final) throw new Error('Failed to add Spotify track to playlist')

        return { trackId: track.trackId, position: final.position, created: track.created }
      },
      catch: (e) =>
        new DatabaseError({
          message: `Failed to add Spotify track: ${getErrorMessage(e)}`,
          operation: 'insert',
          table: 'music_playlist_tracks',
        }),
    })
  })

export const importSpotifyPlaylistEffect = (
  spotify: Pick<SpotifyService, 'getPlaylistForImport'>,
  identity: CanonicalMusicIdentityService,
) =>
  Effect.fn('musicEntity.importSpotifyPlaylist')(function* (
    url: string,
    curatorId?: string | null,
    execution?: PlaylistExecutionHooks,
  ) {
    const db = yield* Database
    const id = getIdFromSpotifyUrl(url)

    if (!id) {
      return yield* new MusicProviderInvalidInput({
        message: 'Could not extract Spotify playlist ID from URL',
        operation: 'importSpotifyPlaylist',
      })
    }

    if (execution) {
      yield* execution.checkpoint
      yield* execution.progress({ phase: 'importing', processed: 0, total: null, failed: 0 })
    }

    const data: SpotifyImportPlaylist = yield* spotify.getPlaylistForImport(id)

    if (execution) {
      yield* execution.checkpoint
      yield* execution.progress({
        phase: 'importing',
        processed: 0,
        total: data.tracks.length,
        failed: 0,
      })
    }

    const resolvedPlaylist = yield* identity.importProviderEntity({
      snapshot: {
        entityType: 'playlist',
        sourceUrl: data.playlistUrl,
        title: data.title,
        imageUrl: data.coverImageUrl ?? undefined,
        description: data.description ?? undefined,
        curatorId,
        sourceMetadata: { spotifyPlaylistId: data.spotifyPlaylistId },
      },
      origin: 'spotify_import',
      artworkDelivery: 'best_effort',
    })

    if (resolvedPlaylist.entityType !== 'playlist') {
      return yield* Effect.die('Spotify playlist import resolved to a non-playlist entity')
    }

    const playlist = resolvedPlaylist.entity

    let processed = 0

    const tracks = yield* Effect.forEach(data.tracks, (track) =>
      Effect.gen(function* () {
        if (execution) yield* execution.checkpoint

        const exit = yield* Effect.exit(
          identity.importProviderEntity({
            snapshot: spotifyTrackSnapshot(track),
            origin: 'spotify_import',
            artworkDelivery: 'preserve',
          }),
        )

        if (execution && Exit.hasInterrupts(exit)) return yield* Effect.failCause(exit.cause)
        processed += 1

        if (execution)
          yield* execution.progress({
            phase: 'importing',
            processed,
            total: data.tracks.length,
            failed: Exit.isFailure(exit) ? 1 : 0,
          })

        if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause)

        return { trackId: exit.value.entity.id, created: exit.value.created }
      }),
    )

    if (execution) yield* execution.checkpoint

    const result = yield* Effect.tryPromise({
      try: async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const playlistRows = await db
            .select()
            .from(musicPlaylistsTable)
            .where(eq(musicPlaylistsTable.id, playlist.id))
            .limit(1)

          const current = playlistRows[0]

          if (!current) throw new Error('Spotify playlist no longer exists')
          const revision = current.revision + 1
          const trackIds = JSON.stringify(tracks.map((track) => track.trackId))

          // Each dependent statement checks changes() from the preceding write in this atomic batch.
          const [advanced] = await db.batch([
            db
              .update(musicPlaylistsTable)
              .set({
                title: data.title,
                description: data.description,
                coverImageUrl: current.coverImageUrl,
                curatorId: current.curatorId ?? curatorId ?? null,
                revision,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(musicPlaylistsTable.id, current.id),
                  eq(musicPlaylistsTable.revision, current.revision),
                ),
              )
              .returning({ id: musicPlaylistsTable.id }),
            ...(tracks.length === 0
              ? []
              : [
                  db
                    .insert(musicPlaylistTracksTable)
                    .select(
                      db
                        .select({
                          playlistId: sql<string>`${current.id}`.as('playlistId'),
                          trackId: sql<string>`value`.as('trackId'),
                          position: sql<number>`cast(key as integer)`.as('position'),
                          addedAt: sql<Date>`${Date.now()}`.as('addedAt'),
                        })
                        .from(sql`json_each(${trackIds})`)
                        .where(sql`changes() > 0`),
                    )
                    .onConflictDoUpdate({
                      target: [
                        musicPlaylistTracksTable.playlistId,
                        musicPlaylistTracksTable.trackId,
                      ],
                      set: { position: sql`excluded.position`, addedAt: sql`excluded."addedAt"` },
                    }),
                ]),
            db
              .delete(musicPlaylistTracksTable)
              .where(
                and(
                  eq(musicPlaylistTracksTable.playlistId, current.id),
                  sql`changes() > 0`,
                  sql`${musicPlaylistTracksTable.trackId} not in (select value from json_each(${trackIds}))`,
                ),
              ),
          ])

          if (advanced.length === 0) continue

          const resultRows = await db
            .select()
            .from(musicPlaylistsTable)
            .where(eq(musicPlaylistsTable.id, current.id))
            .limit(1)

          const updated = resultRows[0]

          if (!updated) throw new Error('Spotify playlist no longer exists')

          return {
            playlist: updated,
            trackCount: data.tracks.length,
            createdTrackCount: tracks.filter((track) => track.created).length,
            reusedTrackCount: tracks.filter((track) => !track.created).length,
          }
        }

        throw new Error('Spotify playlist changed while importing')
      },
      catch: (e) =>
        new DatabaseError({
          message: `Failed to import Spotify playlist: ${getErrorMessage(e)}`,
          operation: 'insert',
          table: 'music_playlists',
        }),
    })

    return result
  })

export const enrichPlaylistLinksEffect = (identity: CanonicalMusicIdentityService) =>
  Effect.fn('musicEntity.enrichPlaylistLinks')(function* (
    playlistId: string,
    execution?: PlaylistExecutionHooks,
  ) {
    if (execution) yield* execution.checkpoint
    const targets = yield* getPlaylistLinkSyncTargetsEffect(playlistId)

    const result = yield* enrichImportedPlaylistLinksEffect(
      identity,
      playlistId,
      targets,
      execution,
    )

    return { playlistId, trackCount: targets.length, insertedCount: result.insertedCount }
  })

export const syncPlaylistLinksEffect = (identity: CanonicalMusicIdentityService) =>
  Effect.fn('musicEntity.syncPlaylistLinks')(function* (
    playlistId: string,
    execution?: PlaylistExecutionHooks,
  ) {
    if (execution) yield* execution.checkpoint
    yield* identity
      .refreshEntity({
        entityType: 'playlist',
        entityId: playlistId,
        actorId: 'playlist_sync',
        origin: 'playlist_enrichment',
        artworkDelivery: 'best_effort',
      })
      .pipe(
        Effect.catchTag('MusicIdentitySourceLinkNotFound', (error) =>
          Effect.andThen(
            Effect.logWarning(
              '[MusicEntity] Playlist refresh skipped without a single exact source',
              {
                playlistId,
                entityType: error.entityType,
                entityId: error.entityId,
              },
            ),
            Effect.succeed(undefined),
          ),
        ),
      )

    return yield* enrichPlaylistLinksEffect(identity)(playlistId, execution)
  })
