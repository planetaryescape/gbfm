import type { D1PreparedStatement } from '@cloudflare/workers-types'
import { sql, type SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { Match } from 'effect'

import type { DatabaseClient } from '@/db/layer'

import type { CreateAlbumInput } from './album.service'
import type { CreateArtistInput } from './artist.service'
import type { CreateLabelInput } from './label.service'
import type { CreateTrackInput } from './track.service'

export type MusicCreate =
  | { readonly entityType: 'artist'; readonly data: CreateArtistInput }
  | { readonly entityType: 'album'; readonly data: CreateAlbumInput }
  | { readonly entityType: 'track'; readonly data: CreateTrackInput }
  | {
      readonly entityType: 'label'
      readonly data: CreateLabelInput
      readonly attribution: 'creator' | 'audit_only'
    }

// Domain-owned SQL plan, shared by ordinary creates and receipt-aware callers.
// No MCP, OAuth, clock or network dependency belongs in this builder.
export interface MusicCreateContext {
  readonly attemptId: string
  readonly fence: SQL
  readonly prepare: (statement: SQL) => D1PreparedStatement
}

export const musicCreateStatements = (
  context: MusicCreateContext,
  command: MusicCreate,
  id: string,
  now: number,
) => {
  const { data, entityType } = command

  const table = sql.identifier(
    {
      artist: 'music_artists',
      album: 'music_albums',
      track: 'music_tracks',
      label: 'music_labels',
    }[entityType],
  )

  const label = entityType === 'label'

  const specific = Match.value(command).pipe(
    Match.when({ entityType: 'artist' }, ({ data }) => ({
      name: data.name,
      bio: data.bio ?? null,
      imageUrl: data.imageUrl ?? null,
    })),
    Match.when({ entityType: 'album' }, ({ data }) => ({
      title: data.title,
      artistNames:
        data.artistNames === undefined || data.artistNames === null
          ? null
          : JSON.stringify(data.artistNames),
      releaseDate: data.releaseDate?.getTime() ?? null,
      coverImageUrl: data.coverImageUrl ?? null,
      albumType: data.albumType ?? null,
    })),
    Match.when({ entityType: 'track' }, ({ data }) => ({
      title: data.title,
      artistNames:
        data.artistNames === undefined || data.artistNames === null
          ? null
          : JSON.stringify(data.artistNames),
      coverImageUrl: data.coverImageUrl ?? null,
      albumId: data.albumId ?? null,
      trackNumber: data.trackNumber ?? null,
    })),
    Match.when({ entityType: 'label' }, ({ data }) => ({
      name: data.name,
      description: data.description ?? null,
      image_url: data.imageUrl ?? null,
      banner_image_url: data.bannerImageUrl ?? null,
      content: data.content,
    })),
    Match.exhaustive,
  )

  const fields = {
    id,
    slug: data.slug,
    revision: 0,
    last_operation_id: context.attemptId,
    ...(label
      ? {
          created_by_id: data.createdById ?? null,
          published_at: data.publishedAt?.getTime() ?? null,
          created_at: now,
          updated_at: now,
        }
      : {
          createdById: data.createdById ?? null,
          publishedAt: data.publishedAt?.getTime() ?? null,
          createdAt: now,
          updatedAt: now,
        }),
    ...specific,
  }

  const winner = sql`(${context.fence}) AND EXISTS (
    SELECT 1 FROM ${table} WHERE id = ${id}
      AND last_operation_id = ${context.attemptId} AND revision = 0
  )`

  const statements = [
    context.prepare(sql`INSERT INTO ${table}
    (${sql.join(
      Object.keys(fields).map((field) => sql.identifier(field)),
      sql`, `,
    )})
    SELECT ${sql.join(
      Object.values(fields).map((value) => sql`${value}`),
      sql`, `,
    )}
    WHERE ${context.fence}`),
  ]

  if (command.entityType === 'album' || command.entityType === 'track') {
    const foreignKey = sql.identifier(command.entityType === 'album' ? 'albumId' : 'trackId')

    const junction = sql.identifier(
      command.entityType === 'album' ? 'music_album_artists' : 'music_track_artists',
    )

    for (const [displayOrder, artistId] of (command.data.artistIds ?? []).entries()) {
      statements.push(
        context.prepare(sql`INSERT INTO ${junction} (${foreignKey}, artistId, displayOrder)
        SELECT ${id}, ${artistId}, ${displayOrder} WHERE ${winner}
        ON CONFLICT(${foreignKey}, artistId) DO UPDATE SET displayOrder = excluded.displayOrder`),
      )
    }

    if (command.data.artistIds !== undefined) {
      statements.push(
        context.prepare(sql`UPDATE ${table} SET artistNames = (
        SELECT CASE WHEN count(*) = 0 THEN NULL ELSE json_group_array(name) END FROM (
          SELECT a.name FROM ${junction} j INNER JOIN music_artists a ON a.id = j.artistId
          WHERE j.${foreignKey} = ${id} ORDER BY j.displayOrder, j.artistId
        )
      ) WHERE id = ${id} AND ${winner}`),
      )
    }
  }

  if (command.entityType === 'label' && command.attribution === 'creator' && data.createdById) {
    statements.push(
      context.prepare(sql`INSERT INTO music_label_creators (label_id, creator_id)
      SELECT ${id}, ${data.createdById} WHERE ${winner}`),
    )
  }

  const tags = command.entityType === 'label' ? command.data.tags : undefined
  const genres = command.entityType === 'track' ? undefined : command.data.genres

  for (const [kind, names] of [
    ['tag', tags],
    ['genre', genres],
  ] as const) {
    for (const [position, name] of [...new Set(names ?? [])].entries()) {
      statements.push(
        context.prepare(sql`INSERT INTO labels (id, kind, name)
          SELECT ${`${id}:${kind}:${position}`}, ${kind}, ${name} WHERE ${winner}
          ON CONFLICT(kind, name) DO NOTHING`),
        context.prepare(sql`INSERT INTO entity_labels (entity_type, entity_id, position, label_id)
          SELECT ${label ? 'musicLabel' : entityType}, ${id}, ${position}, id FROM labels
          WHERE kind = ${kind} AND name = ${name} AND ${winner}`),
      )
    }
  }

  return { statements, assertApplied: winner }
}

const dialect = new SQLiteSyncDialect()

export const insertMusicEntity = async (db: DatabaseClient, command: MusicCreate, id: string) => {
  const context: MusicCreateContext = {
    attemptId: crypto.randomUUID(),
    fence: sql`true`,
    prepare: (statement) => {
      const query = dialect.sqlToQuery(statement)

      return db.$client.prepare(query.sql).bind(...query.params)
    },
  }

  await db.$client.batch(musicCreateStatements(context, command, id, Date.now()).statements)
}
