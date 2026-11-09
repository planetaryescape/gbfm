import { and, asc, desc, eq, isNotNull, lte, or, sql } from 'drizzle-orm'
import { Clock, Effect, Predicate, Result, Schema } from 'effect'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import {
  musicAlbumsTable,
  musicEntityLinksTable,
  musicPlaylistsTable,
  musicPlaylistTracksTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { ConflictError, DatabaseError, getErrorMessage, ValidationError } from '@/errors'
import { CommandAuthority } from '@/mcp/command-authority'
import { McpToolError } from '@/mcp/contracts'
import { McpOperationStore, type OperationPreparation } from '@/mcp/operations/store'
import {
  decodePlaylistCommand,
  type LocalPlaylistCommand,
  playlistCommandScopes,
} from '@/mcp/playlist-edit/contracts'
import { planPlaylistChanges, type PlaylistState } from '@/mcp/playlist-edit/planner'
import { toSlug } from '@/services/to-slug'

import {
  deleteIdentitiesForEntity,
  deleteLinksForEntity,
  requireInserted,
  requireOne,
} from './shared'

export interface CreatePlaylistInput {
  title: string
  description?: string | null
  coverImageUrl?: string | null
  curatorId?: string | null
  slug: string
  publishedAt?: Date | null
  createdById?: string | null
}

/** Only trusted browser session readers may see their own unpublished playlists. */
export interface PlaylistReader {
  readonly id: string
  readonly role: string
}

/** D3: catalogue timestamps are not privacy gates; playlist timestamps are. */
export const publicPlaylistPredicate = (now: Date) =>
  and(isNotNull(musicPlaylistsTable.publishedAt), lte(musicPlaylistsTable.publishedAt, now))

export const readablePlaylistPredicate = (now: Date, reader?: PlaylistReader) =>
  reader?.role === 'admin'
    ? undefined
    : reader
      ? or(publicPlaylistPredicate(now), eq(musicPlaylistsTable.createdById, reader.id))
      : publicPlaylistPredicate(now)

/** Shared anonymous/browser read policy. Never pass an MCP principal as reader. */
export const getReadablePlaylistsEffect = (
  reader?: PlaylistReader,
  id?: string,
  capturedNow?: Date,
) =>
  Effect.gen(function* () {
    const db = yield* Database
    const now = capturedNow ?? new Date(yield* Clock.currentTimeMillis)

    return yield* Effect.tryPromise({
      try: async () => {
        const [account] = reader
          ? await db
              .select({ role: user.role, banned: user.banned })
              .from(user)
              .where(eq(user.id, reader.id))
              .limit(1)
          : []

        const currentReader =
          reader && account && !account.banned
            ? { id: reader.id, role: account.role ?? 'user' }
            : undefined

        const rows = await db
          .select({ playlist: musicPlaylistsTable, spotifyUrl: musicEntityLinksTable.url })
          .from(musicPlaylistsTable)
          .leftJoin(
            musicEntityLinksTable,
            and(
              eq(musicEntityLinksTable.entityType, 'playlist'),
              eq(musicEntityLinksTable.entityId, musicPlaylistsTable.id),
              eq(musicEntityLinksTable.platform, 'spotify'),
              eq(musicEntityLinksTable.status, 'verified'),
            ),
          )
          .where(
            and(
              readablePlaylistPredicate(now, currentReader),
              id ? eq(musicPlaylistsTable.id, id) : undefined,
            ),
          )
          .orderBy(desc(musicPlaylistsTable.createdAt), asc(musicPlaylistsTable.id))

        return rows.map(({ playlist, spotifyUrl }) => ({
          ...playlist,
          // Keep the browser DTO shape without disclosing actor IDs to public readers.
          createdById:
            currentReader &&
            (currentReader.role === 'admin' || currentReader.id === playlist.createdById)
              ? playlist.createdById
              : null,
          curatorId:
            currentReader &&
            (currentReader.role === 'admin' || currentReader.id === playlist.createdById)
              ? playlist.curatorId
              : null,
          spotifyUrl,
        }))
      },
      catch: () =>
        new DatabaseError({
          message: 'Could not read playlists',
          operation: 'select',
          table: 'music_playlists',
        }),
    })
  })

export const getReadablePlaylistByIdEffect = (
  id: string,
  reader?: PlaylistReader,
  capturedNow?: Date,
) =>
  getReadablePlaylistsEffect(reader, id, capturedNow).pipe(
    Effect.flatMap((rows) => requireOne(rows, 'MusicPlaylist', id)),
  )

/** Explicit public projection, reusable by editorial validation and public MCP reads. */
export const getPublicPlaylistEffect = (id: string, capturedNow?: Date) =>
  getReadablePlaylistByIdEffect(id, undefined, capturedNow).pipe(
    Effect.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description,
      coverImageUrl: row.coverImageUrl,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      revision: row.revision,
    })),
  )

/** Complete bounded R2 evidence at a trusted captured instant; no actor override or provider work.
 * Track/album timestamps are returned, NOT filtered: evidence qualification belongs to R2.
 * D1 batch gives the header and memberships one transaction snapshot; 101 detects overflow.
 */
export const getPublicPlaylistSnapshotEffect = Effect.fn('playlist.publicSnapshot')(
  function* (input: {
    readonly playlistId: string
    readonly now: Date
    readonly expectedRevision?: number
  }) {
    const db = yield* Database

    const [headers, members] = yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db
            .select({
              id: musicPlaylistsTable.id,
              title: musicPlaylistsTable.title,
              slug: musicPlaylistsTable.slug,
              description: musicPlaylistsTable.description,
              coverImageUrl: musicPlaylistsTable.coverImageUrl,
              publishedAt: musicPlaylistsTable.publishedAt,
              createdAt: musicPlaylistsTable.createdAt,
              updatedAt: musicPlaylistsTable.updatedAt,
              revision: musicPlaylistsTable.revision,
            })
            .from(musicPlaylistsTable)
            .where(
              and(eq(musicPlaylistsTable.id, input.playlistId), publicPlaylistPredicate(input.now)),
            )
            .limit(1),
          db
            .select({
              trackId: musicPlaylistTracksTable.trackId,
              position: musicPlaylistTracksTable.position,
              addedAt: musicPlaylistTracksTable.addedAt,
              // D1 batch returns objects keyed by SQL column name: unique aliases prevent
              // track/album fields from colliding before Drizzle maps their positions.
              track: {
                id: sql`${musicTracksTable.id}`.mapWith(musicTracksTable.id).as('track_id'),
                title: sql`${musicTracksTable.title}`
                  .mapWith(musicTracksTable.title)
                  .as('track_title'),
                artistNames: sql`${musicTracksTable.artistNames}`
                  .mapWith(musicTracksTable.artistNames)
                  .as('track_artists'),
                albumId: sql`${musicTracksTable.albumId}`
                  .mapWith(musicTracksTable.albumId)
                  .as('track_album_id'),
                trackNumber: sql`${musicTracksTable.trackNumber}`
                  .mapWith(musicTracksTable.trackNumber)
                  .as('track_number'),
                slug: sql`${musicTracksTable.slug}`.mapWith(musicTracksTable.slug).as('track_slug'),
                coverImageUrl: sql`${musicTracksTable.coverImageUrl}`
                  .mapWith(musicTracksTable.coverImageUrl)
                  .as('track_cover'),
                publishedAt: sql`${musicTracksTable.publishedAt}`
                  .mapWith(musicTracksTable.publishedAt)
                  .as('track_published_at'),
              },
              album: {
                id: sql`${musicAlbumsTable.id}`.mapWith(musicAlbumsTable.id).as('album_id'),
                title: sql`${musicAlbumsTable.title}`
                  .mapWith(musicAlbumsTable.title)
                  .as('album_title'),
                artistNames: sql`${musicAlbumsTable.artistNames}`
                  .mapWith(musicAlbumsTable.artistNames)
                  .as('album_artists'),
                slug: sql`${musicAlbumsTable.slug}`.mapWith(musicAlbumsTable.slug).as('album_slug'),
                coverImageUrl: sql`${musicAlbumsTable.coverImageUrl}`
                  .mapWith(musicAlbumsTable.coverImageUrl)
                  .as('album_cover'),
                publishedAt: sql`${musicAlbumsTable.publishedAt}`
                  .mapWith(musicAlbumsTable.publishedAt)
                  .as('album_published_at'),
              },
            })
            .from(musicPlaylistTracksTable)
            .innerJoin(
              musicPlaylistsTable,
              eq(musicPlaylistsTable.id, musicPlaylistTracksTable.playlistId),
            )
            .leftJoin(musicTracksTable, eq(musicTracksTable.id, musicPlaylistTracksTable.trackId))
            .leftJoin(musicAlbumsTable, eq(musicAlbumsTable.id, musicTracksTable.albumId))
            .where(
              and(eq(musicPlaylistsTable.id, input.playlistId), publicPlaylistPredicate(input.now)),
            )
            .orderBy(asc(musicPlaylistTracksTable.position), asc(musicPlaylistTracksTable.trackId))
            .limit(101),
        ]),
      catch: () =>
        new DatabaseError({
          message: 'Could not read playlist snapshot',
          operation: 'select',
          table: 'music_playlists',
        }),
    })

    const playlist = yield* requireOne(headers, 'MusicPlaylist', input.playlistId)

    if (input.expectedRevision !== undefined && input.expectedRevision !== playlist.revision)
      return yield* new ConflictError({ message: 'Playlist revision changed.' })

    if (members.length > 100)
      return yield* new ValidationError({
        message: 'Complete playlist snapshot supports at most 100 memberships.',
      })

    return {
      playlist,
      members: members.map((member) => ({
        ...member,
        track: member.track.id === null ? null : member.track,
        album: member.album.id === null ? null : member.album,
      })),
      snapshotTime: input.now,
    }
  },
)

/** Shared desired-state observation for preview and the receipt's read-only prepare phase. */
const observePlaylistCommand = Effect.fn('playlist.observeCommand')(function* (
  command: LocalPlaylistCommand,
  now: number,
) {
  const db = yield* Database
  let snapshot: PlaylistState | null = null

  if (command.operation !== 'create_playlist') {
    const [headers, memberships] = yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db
            .select()
            .from(musicPlaylistsTable)
            .where(eq(musicPlaylistsTable.id, command.playlistId))
            .limit(1),
          db
            .select({
              trackId: musicPlaylistTracksTable.trackId,
              position: musicPlaylistTracksTable.position,
              addedAt: musicPlaylistTracksTable.addedAt,
            })
            .from(musicPlaylistTracksTable)
            .where(eq(musicPlaylistTracksTable.playlistId, command.playlistId))
            .orderBy(asc(musicPlaylistTracksTable.position), asc(musicPlaylistTracksTable.trackId))
            .limit(501),
        ]),
      catch: () =>
        new McpToolError({ code: 'unavailable', message: 'Playlist observation unavailable.' }),
    })

    const header = headers[0]

    if (!header)
      return yield* new McpToolError({ code: 'not_found', message: 'Playlist not found.' })
    snapshot = {
      playlistId: header.id,
      revision: header.revision,
      metadata: {
        title: header.title,
        slug: header.slug,
        description: header.description,
        coverImageUrl: header.coverImageUrl,
      },
      publishedAt: header.publishedAt?.getTime() ?? null,
      members: memberships.map((member) => ({ ...member, addedAt: member.addedAt.getTime() })),
    }
  }

  const catalogue =
    command.operation === 'add_playlist_tracks'
      ? yield* Effect.tryPromise({
          try: () =>
            db
              .select({ id: musicTracksTable.id })
              .from(musicTracksTable)
              .where(
                sql`${musicTracksTable.id} IN (SELECT value FROM json_each(${JSON.stringify(command.trackIds)}))`,
              ),
          catch: () =>
            new McpToolError({ code: 'unavailable', message: 'Track observation unavailable.' }),
        })
      : []

  return yield* planPlaylistChanges({
    command,
    snapshot,
    now,
    catalogueTrackIds: new Set(catalogue.map((row) => row.id)),
  }).pipe(
    Effect.mapError(
      (error) =>
        new McpToolError({
          code: Predicate.isTagged(error, 'ConflictError') ? 'conflict' : 'invalid_input',
          message: error.message,
        }),
    ),
  )
})

export const previewPlaylistCommandEffect = Effect.fn('playlist.previewCommand')(function* (
  command: LocalPlaylistCommand,
) {
  const authority = yield* CommandAuthority
  yield* authority.checkpoint(playlistCommandScopes(command))
  const result = yield* observePlaylistCommand(command, yield* Clock.currentTimeMillis)
  // Preview is informational, never a reservation. Apply must repeat both observation and CAS.
  yield* authority.checkpoint(playlistCommandScopes(command))

  const envelope = JSON.stringify({
    structuredContent: result,
    content: [{ type: 'text', text: JSON.stringify(result) }],
  })

  if (new TextEncoder().encode(envelope).byteLength > 250_000)
    return yield* new McpToolError({
      code: 'invalid_input',
      message: 'Playlist preview exceeds response budget.',
    })

  return result
})

/** Shared browser/MCP command persistence. All state observation happens after receipt lookup. */
export const applyPlaylistCommandEffect = Effect.fn('playlist.applyCommand')(function* (
  input: LocalPlaylistCommand,
) {
  const db = yield* Database
  const authority = yield* CommandAuthority
  const store = yield* McpOperationStore
  const runPromise = Effect.runPromiseWith(yield* Effect.context<Database>())

  const command = yield* decodePlaylistCommand(input).pipe(
    Effect.mapError(
      () => new McpToolError({ code: 'invalid_input', message: 'Invalid playlist command.' }),
    ),
  )

  if (
    command.operation === 'add_playlist_track_from_url' ||
    command.operation === 'sync_playlist_links'
  )
    return yield* new McpToolError({
      code: 'unavailable',
      message: 'Provider command requires the import status integration.',
    })

  const scopes = playlistCommandScopes(command)
  const checkpoint = yield* authority.checkpoint(scopes)
  const now = yield* Clock.currentTimeMillis
  const savedAccess = Schema.Struct({ playlistId: Schema.String })

  const result = yield* Effect.tryPromise({
    try: (signal) =>
      store.execute({
        key: {
          actorId: checkpoint.actorId,
          clientId: checkpoint.clientId,
          resource: checkpoint.resource,
          operation: command.operation,
          requestId: command.requestId,
        },
        normalizedInput: command,
        now,
        authorize: async (outcome) => {
          const current = await runPromise(authority.checkpoint(scopes).pipe(Effect.result), {
            signal,
          })

          if (Result.isFailure(current)) {
            if (current.failure.code === 'access_denied') return false
            throw current.failure
          }

          if (!outcome) return true
          const access = Schema.decodeUnknownSync(savedAccess)(outcome.access)

          const rows = await db
            .select({ id: musicPlaylistsTable.id })
            .from(musicPlaylistsTable)
            .where(eq(musicPlaylistsTable.id, access.playlistId))
            .limit(1)

          return rows.length === 1
        },
        prepare: async (): Promise<OperationPreparation> => {
          const planned = await runPromise(
            observePlaylistCommand(command, now).pipe(Effect.result),
            { signal },
          )

          if (Result.isFailure(planned)) {
            const code = planned.failure.code

            return {
              status:
                code === 'conflict' || code === 'not_found' || code === 'invalid_input'
                  ? code
                  : 'unavailable',
            }
          }

          const plan = planned.success

          return {
            status: 'ready',
            build: (ctx) => {
              const playlistId = plan.playlistId ?? crypto.randomUUID()

              const winner = sql`EXISTS (SELECT 1 FROM music_playlists WHERE id = ${playlistId}
            AND revision = ${plan.revision} AND last_operation_id = ${ctx.attemptId})`

              const guarded = sql`(${ctx.fence}) AND (${checkpoint.liveGuard}) AND (${winner})`
              const metadata = plan.after.metadata

              const statements = [
                ctx.prepare(
                  plan.playlistId === null
                    ? sql`INSERT INTO music_playlists (id,title,slug,description,coverImageUrl,publishedAt,createdById,createdAt,updatedAt,revision,last_operation_id)
                SELECT ${playlistId},${metadata.title},${metadata.slug},${metadata.description},${metadata.coverImageUrl},NULL,${checkpoint.actorId},${now},${now},0,${ctx.attemptId}
                WHERE (${ctx.fence}) AND (${checkpoint.liveGuard})`
                    : sql`UPDATE music_playlists SET title=${metadata.title},slug=${metadata.slug},description=${metadata.description},coverImageUrl=${metadata.coverImageUrl},
                publishedAt=${plan.after.publishedAt},revision=${plan.revision},last_operation_id=${ctx.attemptId},
                updatedAt=CASE WHEN ${plan.changed ? 1 : 0} THEN ${now} ELSE updatedAt END
                WHERE id=${playlistId} AND revision=${plan.expectedRevision} AND (${ctx.fence}) AND (${checkpoint.liveGuard})`,
                ),
              ]

              if (
                plan.changed &&
                [
                  'add_playlist_tracks',
                  'remove_playlist_tracks',
                  'reorder_playlist_tracks',
                ].includes(command.operation)
              ) {
                statements.push(
                  ctx.prepare(
                    sql`DELETE FROM music_playlist_tracks WHERE playlistId=${playlistId} AND (${guarded})`,
                  ),
                )

                if (plan.after.members.length > 0)
                  statements.push(
                    ctx.prepare(sql`INSERT INTO music_playlist_tracks (playlistId,trackId,position,addedAt)
              SELECT ${playlistId},json_extract(value,'$.trackId'),json_extract(value,'$.position'),json_extract(value,'$.addedAt')
              FROM json_each(${JSON.stringify(plan.after.members)}) WHERE (${guarded})`),
                  )
              }

              return {
                statements,
                assertApplied: guarded,
                outcome: {
                  result: {
                    playlistId,
                    revision: plan.revision,
                    changed: plan.changed,
                    membershipCount: plan.after.members.length,
                  },
                  revision: plan.revision,
                  access: { playlistId },
                },
              }
            },
          }
        },
      }),
    catch: () =>
      new McpToolError({
        code: 'unavailable',
        message: 'Playlist command unavailable; retry the same request.',
      }),
  })

  if (result.status !== 'applied' && result.status !== 'replayed')
    return yield* new McpToolError({
      code: result.status,
      message: `Playlist command ${result.status}.`,
    })

  const output = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      playlistId: Schema.String,
      revision: Schema.Int,
      changed: Schema.Boolean,
      membershipCount: Schema.Int,
    }),
  )(result.outcome.result).pipe(
    Effect.mapError(
      () => new McpToolError({ code: 'unavailable', message: 'Playlist receipt unavailable.' }),
    ),
  )

  return { ...output, operationId: result.operationId, replayed: result.status === 'replayed' }
})

export const createPlaylistEffect = Effect.fn('musicEntity.createPlaylist')(function* (
  data: CreatePlaylistInput,
) {
  const db = yield* Database

  const rows = yield* Effect.tryPromise({
    try: () => db.insert(musicPlaylistsTable).values(data).returning(),
    catch: (e) =>
      new DatabaseError({
        message: `Failed to create playlist: ${getErrorMessage(e)}`,
        operation: 'insert',
        table: 'music_playlists',
      }),
  })

  return yield* requireInserted(rows, 'music_playlists')
})

export const getPlaylistsEffect = Effect.gen(function* () {
  const db = yield* Database

  return yield* Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({
          playlist: musicPlaylistsTable,
          spotifyUrl: musicEntityLinksTable.url,
        })
        .from(musicPlaylistsTable)
        .leftJoin(
          musicEntityLinksTable,
          and(
            eq(musicEntityLinksTable.entityType, 'playlist'),
            eq(musicEntityLinksTable.entityId, musicPlaylistsTable.id),
            eq(musicEntityLinksTable.platform, 'spotify'),
          ),
        )
        .orderBy(desc(musicPlaylistsTable.createdAt), asc(musicPlaylistsTable.id))

      return rows.map((r) => ({ ...r.playlist, spotifyUrl: r.spotifyUrl }))
    },
    catch: (e) =>
      new DatabaseError({
        message: `Failed to list playlists: ${getErrorMessage(e)}`,
        operation: 'select',
        table: 'music_playlists',
      }),
  })
}).pipe(Effect.withSpan('musicEntity.getPlaylists'))

export const getPlaylistByIdEffect = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: async () => {
        const result = await db
          .select({
            playlist: musicPlaylistsTable,
            spotifyUrl: musicEntityLinksTable.url,
          })
          .from(musicPlaylistsTable)
          .leftJoin(
            musicEntityLinksTable,
            and(
              eq(musicEntityLinksTable.entityType, 'playlist'),
              eq(musicEntityLinksTable.entityId, musicPlaylistsTable.id),
              eq(musicEntityLinksTable.platform, 'spotify'),
            ),
          )
          .where(eq(musicPlaylistsTable.id, id))
          .limit(1)

        return result.map((r) => ({ ...r.playlist, spotifyUrl: r.spotifyUrl }))
      },
      catch: (e) =>
        new DatabaseError({
          message: `Failed to get playlist: ${getErrorMessage(e)}`,
          operation: 'select',
          table: 'music_playlists',
        }),
    })

    return yield* requireOne(rows, 'MusicPlaylist', id)
  }).pipe(Effect.withSpan('musicEntity.getPlaylistById', { attributes: { id } }))

export const updatePlaylistEffect = (id: string, data: Partial<CreatePlaylistInput>) =>
  Effect.gen(function* () {
    const db = yield* Database
    const updateData = { ...data }

    if (updateData.title && !updateData.slug) {
      updateData.slug = toSlug(updateData.title)
    }

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .update(musicPlaylistsTable)
          .set({ ...updateData, updatedAt: new Date() })
          .where(eq(musicPlaylistsTable.id, id))
          .returning(),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to update playlist: ${getErrorMessage(e)}`,
          operation: 'update',
          table: 'music_playlists',
        }),
    })

    return yield* requireOne(rows, 'MusicPlaylist', id)
  }).pipe(Effect.withSpan('musicEntity.updatePlaylist', { attributes: { id } }))

export const deletePlaylistEffect = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () =>
        (async () => {
          const [, , rows] = await db.batch([
            deleteIdentitiesForEntity(db, 'playlist', id),
            deleteLinksForEntity(db, 'playlist', id),
            db
              .delete(musicPlaylistsTable)
              .where(eq(musicPlaylistsTable.id, id))
              .returning({ id: musicPlaylistsTable.id }),
          ])

          return rows
        })(),
      catch: (e) =>
        new DatabaseError({
          message: `Failed to delete playlist: ${getErrorMessage(e)}`,
          operation: 'delete',
          table: 'music_playlists',
        }),
    })

    yield* requireOne(rows, 'MusicPlaylist', id)
  }).pipe(Effect.withSpan('musicEntity.deletePlaylist', { attributes: { id } }))
