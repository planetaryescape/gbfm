import { and, asc, count, eq, sql } from 'drizzle-orm'
import { Context, Effect, Layer, Schema } from 'effect'

import { Database } from '@/db/layer'
import {
  musicEntityLinksTable,
  musicPlaylistTracksTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { getPublicPlaylistEffect } from '@/services/music-entity/playlist.service'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { EditorialToolError, EndpointIdentity } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import {
  type CompareInput,
  CompareResult,
  ExportDocument,
  ExportResult,
  type PlaylistInput,
  type PlaylistPageInput,
  PlaylistResult,
  PlaylistTracksResult,
} from './contracts'

const unavailable = () =>
  new EditorialToolError({ code: 'unavailable', message: 'Playlist reads unavailable.' })

const tooLarge = () =>
  new EditorialToolError({
    code: 'invalid_input',
    message:
      'Playlist exceeds read budget. Use bounded track pages; comparison/export support at most 500 memberships per playlist.',
  })

const bytes = (text: string) => new TextEncoder().encode(text).byteLength

/** Include both MCP representations, nested string escaping and envelope overhead. */
const bound = <A>(output: A) =>
  bytes(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'x'.repeat(200),
      result: {
        structuredContent: output,
        content: [{ type: 'text', text: JSON.stringify(output) }],
        isError: false,
      },
    }),
  ) <=
  256 * 1024
    ? Effect.succeed(output)
    : Effect.fail(tooLarge())

const makeReads = Effect.gen(function* () {
  const db = yield* Database
  const authorization = yield* McpAuthorization
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(unavailable),
  )

  const links = Effect.fn('PlaylistRead.links')(function* (
    kind: 'track' | 'playlist',
    ids: ReadonlyArray<string>,
  ) {
    if (ids.length === 0) return []

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            entityId: musicEntityLinksTable.entityId,
            platform: musicEntityLinksTable.platform,
            url: musicEntityLinksTable.url,
          })
          .from(musicEntityLinksTable)
          .where(
            and(
              eq(musicEntityLinksTable.entityType, kind),
              sql`${musicEntityLinksTable.entityId} in (select value from json_each(${JSON.stringify(ids)}))`,
              eq(musicEntityLinksTable.status, 'verified'),
            ),
          )
          .orderBy(
            asc(musicEntityLinksTable.entityId),
            asc(musicEntityLinksTable.platform),
            asc(musicEntityLinksTable.url),
          )
          .limit(ids.length * 16 + 1),
      catch: unavailable,
    })

    if (rows.length > ids.length * 16) return yield* tooLarge()

    return rows.filter(({ url }) => {
      try {
        const parsed = new URL(url)

        return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      } catch {
        return false
      }
    })
  })

  const playlist = Effect.fn('PlaylistRead.playlist')(function* (id: string) {
    const row = yield* getPublicPlaylistEffect(id).pipe(
      Effect.provideService(Database, db),
      Effect.catchTags({
        DatabaseError: () => Effect.fail(unavailable()),
        NotFoundError: () =>
          Effect.fail(
            new EditorialToolError({ code: 'not_found', message: 'Playlist not found.' }),
          ),
      }),
    )

    const providerLinks = yield* links('playlist', [id])

    return yield* Schema.decodeUnknownEffect(PlaylistResult.fields.playlist)({
      playlistId: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description,
      coverImageUrl: row.coverImageUrl,
      publishedAt: row.publishedAt?.toISOString(),
      revision: row.revision,
      links: providerLinks.map(({ platform, url }) => ({ platform, url })),
    }).pipe(Effect.mapError(unavailable))
  })

  const entries = Effect.fn('PlaylistRead.entries')(function* (
    id: string,
    limit: number,
    offset: number,
  ) {
    const [totals, rows] = yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db
            .select({ total: count() })
            .from(musicPlaylistTracksTable)
            .where(eq(musicPlaylistTracksTable.playlistId, id)),
          db
            .select({
              trackId: musicPlaylistTracksTable.trackId,
              position: musicPlaylistTracksTable.position,
              addedAt: musicPlaylistTracksTable.addedAt,
              track: {
                id: musicTracksTable.id,
                title: musicTracksTable.title,
                artistNames: musicTracksTable.artistNames,
                slug: musicTracksTable.slug,
                coverImageUrl: musicTracksTable.coverImageUrl,
              },
            })
            .from(musicPlaylistTracksTable)
            .leftJoin(musicTracksTable, eq(musicTracksTable.id, musicPlaylistTracksTable.trackId))
            .where(eq(musicPlaylistTracksTable.playlistId, id))
            .orderBy(asc(musicPlaylistTracksTable.position), asc(musicPlaylistTracksTable.trackId))
            .limit(limit)
            .offset(offset),
        ]),
      catch: unavailable,
    })

    const providerLinks = yield* links(
      'track',
      rows.flatMap((row) => (row.track ? [row.trackId] : [])),
    )

    const projected = rows.map((row) => ({
      trackId: row.trackId,
      position: row.position,
      addedAt: row.addedAt.toISOString(),
      track: row.track
        ? {
            title: row.track.title,
            artistNames: row.track.artistNames ?? [],
            slug: row.track.slug,
            coverImageUrl: row.track.coverImageUrl,
            links: providerLinks
              .filter((link) => link.entityId === row.trackId)
              .map(({ platform, url }) => ({ platform, url })),
          }
        : null,
    }))

    return { entries: projected, total: totals[0]?.total ?? 0 }
  })

  const complete = Effect.fn('PlaylistRead.complete')(function* (id: string) {
    const header = yield* playlist(id)
    const result = yield* entries(id, 501, 0)

    if (result.total > 500) return yield* tooLarge()
    // Reject concurrent metadata/order/membership changes instead of exporting a mixed revision.
    const after = yield* playlist(id)

    if (JSON.stringify(after) !== JSON.stringify(header))
      return yield* new EditorialToolError({
        code: 'conflict',
        message: 'Playlist changed; retry the read.',
      })

    return { playlist: header, entries: result.entries }
  })

  const getPlaylist = Effect.fn('PlaylistRead.getPlaylist')(function* (
    input: typeof PlaylistInput.Type,
  ) {
    yield* authorization.catalogue

    return yield* bound({ endpoint, playlist: yield* playlist(input.playlistId) })
  })

  const getPlaylistTracks = Effect.fn('PlaylistRead.getPlaylistTracks')(function* (
    input: typeof PlaylistPageInput.Type,
  ) {
    yield* authorization.catalogue
    const header = yield* playlist(input.playlistId)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const result = yield* entries(input.playlistId, limit, offset)
    const after = yield* playlist(input.playlistId)

    if (JSON.stringify(after) !== JSON.stringify(header))
      return yield* new EditorialToolError({
        code: 'conflict',
        message: 'Playlist changed; retry the read.',
      })

    return yield* Schema.decodeUnknownEffect(PlaylistTracksResult)({
      endpoint,
      playlist: header,
      entries: result.entries,
      pagination: { limit, offset, total: result.total, hasMore: offset + limit < result.total },
    }).pipe(Effect.mapError(unavailable), Effect.flatMap(bound))
  })

  const comparePlaylists = Effect.fn('PlaylistRead.comparePlaylists')(function* (
    input: typeof CompareInput.Type,
  ) {
    yield* authorization.catalogue
    const left = yield* complete(input.leftPlaylistId)
    const right = yield* complete(input.rightPlaylistId)

    const leftIds = new Set(
      left.entries.filter((entry) => entry.track !== null).map((entry) => entry.trackId),
    )

    const rightIds = new Set(
      right.entries.filter((entry) => entry.track !== null).map((entry) => entry.trackId),
    )

    return yield* Schema.decodeUnknownEffect(CompareResult)({
      endpoint,
      left: left.playlist,
      right: right.playlist,
      identity: 'gbfm_track_id',
      limitation:
        'Only existing GBFM track IDs match. Provider URLs, titles and artists do not prove recording equivalence. Missing catalogue rows are excluded from overlap; this is not duplicate detection.',
      sharedTrackIds: [...leftIds].filter((id) => rightIds.has(id)),
      leftOnlyTrackIds: [...leftIds].filter((id) => !rightIds.has(id)),
      rightOnlyTrackIds: [...rightIds].filter((id) => !leftIds.has(id)),
      leftMissingTrackIds: left.entries
        .filter((entry) => entry.track === null)
        .map((entry) => entry.trackId),
      rightMissingTrackIds: right.entries
        .filter((entry) => entry.track === null)
        .map((entry) => entry.trackId),
    }).pipe(Effect.mapError(unavailable), Effect.flatMap(bound))
  })

  const exportPlaylist = Effect.fn('PlaylistRead.exportPlaylist')(function* (
    input: typeof PlaylistInput.Type,
  ) {
    yield* authorization.catalogue
    const result = yield* complete(input.playlistId)

    const document = yield* Schema.decodeUnknownEffect(ExportDocument)({
      format: 'gbfm-playlist',
      version: 1,
      endpoint,
      ...result,
    }).pipe(Effect.mapError(unavailable))

    const content = JSON.stringify(document)

    if (bytes(content) > 64 * 1024) return yield* tooLarge()

    return yield* Schema.decodeUnknownEffect(ExportResult)({
      endpoint,
      mediaType: 'application/json',
      filename: 'gbfm-playlist.json',
      byteLength: bytes(content),
      content,
    }).pipe(Effect.mapError(unavailable), Effect.flatMap(bound))
  })

  return { getPlaylist, getPlaylistTracks, comparePlaylists, exportPlaylist }
})

export class PlaylistReadService extends Context.Service<
  PlaylistReadService,
  Effect.Success<typeof makeReads>
>()('gbfm/mcp/PlaylistReadService') {}

export const PlaylistReadServiceLayer = Layer.effect(PlaylistReadService, makeReads).pipe(
  Layer.provide(McpAuthorizationLive),
)
