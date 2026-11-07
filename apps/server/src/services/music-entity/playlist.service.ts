import { and, asc, desc, eq, isNotNull, lte, or } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { musicEntityLinksTable, musicPlaylistsTable } from '@/db/music-entity.schema'
import { DatabaseError, getErrorMessage } from '@/errors'
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
export const getReadablePlaylistsEffect = (reader?: PlaylistReader, id?: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    const now = new Date(yield* Clock.currentTimeMillis)

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

        return rows.map(({ playlist, spotifyUrl }) => ({ ...playlist, spotifyUrl }))
      },
      catch: () =>
        new DatabaseError({
          message: 'Could not read playlists',
          operation: 'select',
          table: 'music_playlists',
        }),
    })
  })

export const getReadablePlaylistByIdEffect = (id: string, reader?: PlaylistReader) =>
  getReadablePlaylistsEffect(reader, id).pipe(
    Effect.flatMap((rows) => requireOne(rows, 'MusicPlaylist', id)),
  )

/** Explicit public projection, reusable by editorial validation and public MCP reads. */
export const getPublicPlaylistEffect = (id: string) =>
  getReadablePlaylistByIdEffect(id).pipe(
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
