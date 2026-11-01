import { and, asc, count, desc, eq, type SQL, sql } from 'drizzle-orm'
import { Context, Crypto, Effect, Layer } from 'effect'
import { Hex } from 'effect/encoding'

import { audioVisibilityCondition } from '@/db/audio-visibility'
import {
  audioCreators,
  audioArtists,
  audioTable,
  type InsertAudio,
  type SelectAudio,
  type SelectMdxCompiledAudio,
} from '@/db/audio.schema'
import { audioIdsForCreator } from '@/db/creator-membership'
import { decodeEntityTags, entityTagsProjection } from '@/db/entity-label-projection'
import {
  hasEntityLabel,
  projectEntityLabels,
  projectEntityLabelsForRows,
  replaceEntityLabels,
} from '@/db/labels'
import { Database } from '@/db/layer'
import { timeQuery } from '@/db/query-timer'
import { showsTable } from '@/db/show.schema'
import { entityLabelsTable, labelsTable } from '@/db/tags.schema'
import {
  ConflictError,
  DatabaseError,
  getErrorMessage,
  NotFoundError,
  type UnauthorizedError,
  type ValidationError,
  type S3Error,
} from '@/errors'
import { requireCreatorOrAdmin } from '@/lib/authorization'
import { CryptoLive } from '@/lib/crypto'
import { MdxService, validateCanonicalContent } from '@/lib/mdx'
import { createPaginationMetadata, type PaginationMetadata } from '@/lib/pagination'
import { recordAudioCreate } from '@/lib/performance-monitoring'
import { ConfigService } from '@/services/config.service'
import { makeMediaPublication, type MediaPublication } from '@/services/media-publication'
import { ObjectStoreClient } from '@/services/storage/object-store-client'
import { markAttachedAssets, UploadAssetService } from '@/services/upload-asset.service'

import {
  artistCredits,
  projectAudioArtists,
  replaceAudioArtists,
  validateAudioArtists,
} from './audio-artists'

type AudioType = 'mix' | 'track' | 'misc'

type CreateAudioData = InsertAudio

export type AudioSortField = 'plays' | 'created'

export type AudioSortOrder = 'asc' | 'desc'

const audioSortColumns = {
  plays: audioTable.playCount,
  created: audioTable.createdAt,
} as const

const audioOrderBy = (sort: AudioSortField, order: AudioSortOrder) => {
  const column = audioSortColumns[sort]
  const primary = order === 'asc' ? asc(column) : desc(column)

  return sort === 'created' ? [primary] : [primary, desc(audioTable.createdAt)]
}

type CreateAudioOptions = {
  actorId: string
  actorRole?: string
  idempotencyKey: string
}

class AudioCreateConflict extends Error {
  constructor() {
    super('Audio create conflict')
  }
}

type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | ReadonlyArray<CanonicalValue>
  | { readonly [key: string]: CanonicalValue }

const canonicalize = (value: CanonicalValue): CanonicalValue => {
  if (value instanceof Date) return value.toISOString()

  if (Array.isArray(value)) return value.map(canonicalize)

  if (value instanceof Object) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }

  return value
}

export const createAudioFingerprint = (data: CreateAudioData, creatorIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto

    const input = new TextEncoder().encode(
      JSON.stringify(canonicalize({ data, creatorIds: [...creatorIds].toSorted() })),
    )

    return yield* crypto.digest('SHA-256', input).pipe(Effect.orDie, Effect.map(Hex.encode))
  })

type AudioWithCreators = SelectAudio & {
  creators: Array<{
    id: string
    name: string
    username: string | null
  }>
}

export interface AudioService {
  readonly getByType: (
    type: AudioType,
    options: { limit: number; offset: number; tag?: string },
  ) => Effect.Effect<
    { data: Array<AudioWithCreators>; pagination: PaginationMetadata },
    DatabaseError
  >
  readonly getByTypeForEdit: (
    type: AudioType,
    options: {
      limit: number
      offset: number
      tag?: string
      sort?: AudioSortField
      order?: AudioSortOrder
    },
    userId: string,
    userRole: string,
  ) => Effect.Effect<
    { data: Array<AudioWithCreators>; pagination: PaginationMetadata },
    DatabaseError
  >
  readonly getTags: (type: AudioType) => Effect.Effect<Array<string>, DatabaseError>
  readonly getBySlug: (
    type: AudioType,
    slug: string,
    actor?: { userId: string; userRole: string },
  ) => Effect.Effect<SelectMdxCompiledAudio, DatabaseError | NotFoundError>
  readonly getBySlugForEdit: (
    type: AudioType,
    slug: string,
    userId: string,
    userRole: string,
  ) => Effect.Effect<SelectMdxCompiledAudio, DatabaseError | NotFoundError | UnauthorizedError>
  readonly create: (
    data: CreateAudioData,
    creatorIds: Array<string>,
    options: CreateAudioOptions,
  ) => Effect.Effect<
    SelectAudio,
    DatabaseError | ConflictError | ValidationError | UnauthorizedError | S3Error
  >
  readonly update: (
    type: AudioType,
    slug: string,
    userId: string,
    userRole: string,
    data: Partial<InsertAudio> & { creatorIds?: Array<string> },
  ) => Effect.Effect<
    SelectMdxCompiledAudio,
    DatabaseError | NotFoundError | UnauthorizedError | ValidationError | S3Error
  >
  readonly trackPlay: (
    id: string,
    clientIp?: string,
  ) => Effect.Effect<{ playCount: number }, DatabaseError | NotFoundError>
}

export const AudioService = Context.Service<AudioService>('AudioService')

const getByTypeEffect = (
  type: AudioType,
  options: {
    limit: number
    offset: number
    tag?: string
    sort?: AudioSortField
    order?: AudioSortOrder
  },
  actor?: { userId: string; userRole: string },
) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { limit, offset, tag } = options
    const orderBy = audioOrderBy(options.sort ?? 'created', options.order ?? 'desc')

    yield* Effect.annotateCurrentSpan('audio.type', type)
    yield* Effect.annotateCurrentSpan('audio.limit', limit)
    yield* Effect.annotateCurrentSpan('audio.offset', offset)

    if (tag) yield* Effect.annotateCurrentSpan('audio.tag', tag)

    const whereCondition = and(
      eq(audioTable.type, type),
      audioListVisibilityCondition(db, actor),
      tag ? hasEntityLabel('audio', audioTable.id, tag) : undefined,
    )

    const countResult = yield* Effect.tryPromise({
      try: () =>
        timeQuery(
          () => db.select({ total: count() }).from(audioTable).where(whereCondition),
          'get-audio-by-type-count',
        ),
      catch: (error) =>
        error instanceof Error
          ? new DatabaseError({
              message: `Failed to count audio: ${error.message}`,
              operation: 'select',
              table: 'audio',
            })
          : new DatabaseError({
              message: `Failed to count audio: Unknown error: ${String(error)}`,
              operation: 'select',
              table: 'audio',
            }),
    })

    const total = countResult[0]?.total ?? 0

    const audioItems = yield* Effect.tryPromise({
      try: () =>
        timeQuery(
          () =>
            db.query.audioTable.findMany({
              where: whereCondition,
              limit,
              offset,
              orderBy,
              with: {
                audioArtists: {
                  orderBy: [asc(audioArtists.position), asc(audioArtists.artistId)],
                  with: { artist: { columns: { id: true, name: true, slug: true } } },
                },
                audioCreators: {
                  with: { creator: true },
                },
                show: {
                  columns: { thumbnailUrl: true },
                },
              },
            }),
          'get-audio-by-type-data',
        ),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch audio: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'audio',
        }),
    })

    const projectedAudio = yield* Effect.tryPromise({
      try: () => projectEntityLabelsForRows(db, 'audio', audioItems),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })

    const data = projectedAudio.map(
      ({ audioCreators: creators, audioArtists: credits, show, ...audio }) => ({
        ...audio,
        artists: artistCredits(credits),
        thumbnailUrl: audio.thumbnailUrl ?? show?.thumbnailUrl ?? null,
        creators: creators.map(({ creator }) => ({
          id: creator.id,
          name: creator.name,
          username: creator.username,
        })),
      }),
    )

    return {
      data,
      pagination: createPaginationMetadata(total, limit, offset),
    }
  })

const getTagsEffect = (type: AudioType) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .selectDistinct({ tag: labelsTable.name })
          .from(audioTable)
          .innerJoin(
            entityLabelsTable,
            and(
              eq(entityLabelsTable.entityType, 'audio'),
              eq(entityLabelsTable.entityId, audioTable.id),
            ),
          )
          .innerJoin(
            labelsTable,
            and(eq(labelsTable.id, entityLabelsTable.labelId), eq(labelsTable.kind, 'tag')),
          )
          .where(and(eq(audioTable.type, type), eq(audioTable.draft, false))),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch audio tags: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'audio',
        }),
    })

    return rows
      .map((row) => row.tag)
      .filter((tag) => tag.length > 0)
      .toSorted()
  })

// Manage/dashboard list: a non-admin actor sees only their own content
// (draft or live), not the public catalog plus their drafts.
const audioListVisibilityCondition = (
  db: Database['Service'],
  actor?: { userId: string; userRole: string },
) => {
  if (!actor) return eq(audioTable.draft, false)

  if (actor.userRole === 'admin') return undefined

  return audioIdsForCreator(db, actor.userId)
}

const findAudioBySlug = (_type: AudioType, slug: string, mdx: MdxService, where: SQL | undefined) =>
  Effect.gen(function* () {
    const db = yield* Database

    const audio = yield* Effect.tryPromise({
      try: async () => {
        const audio = await db.query.audioTable.findFirst({
          where,
          extras: (audio) => ({ tagsJson: entityTagsProjection('audio', audio.id) }),
          with: {
            audioArtists: {
              orderBy: [asc(audioArtists.position), asc(audioArtists.artistId)],
              with: { artist: { columns: { id: true, name: true, slug: true } } },
            },
            audioCreators: {
              with: { creator: true },
            },
            show: {
              columns: { thumbnailUrl: true, slug: true, title: true },
            },
          },
        })

        if (!audio) return undefined

        const { tagsJson, ...fields } = audio

        return { ...fields, tags: decodeEntityTags(tagsJson) }
      },
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch audio: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'audio',
        }),
    }).pipe(Effect.withSpan('audio.findBySlug.query'))

    if (!audio) {
      return yield* new NotFoundError({
        message: 'Audio not found',
        resource: 'audio',
        id: slug,
      })
    }

    let compiledContent = ''

    const richContent = yield* mdx
      .render(audio.content)
      .pipe(Effect.withSpan('audio.renderContent'))

    if (audio.content) {
      compiledContent = yield* mdx.compile(audio.content).pipe(Effect.orElseSucceed(() => ''))
    }

    const { audioCreators: creators, audioArtists: credits, show, ...audioFields } = audio

    return {
      ...audioFields,
      artists: artistCredits(credits),
      thumbnailUrl: audioFields.thumbnailUrl ?? show?.thumbnailUrl ?? null,
      show: show ? { slug: show.slug, title: show.title } : null,
      compiledContent,
      richContent,
      creators: creators.map(({ creator }) => ({
        id: creator.id,
        name: creator.name,
        username: creator.username,
      })),
    }
  })

// Public/actor-aware lookup: visibility is decided in the WHERE clause, so a
// draft row a viewer isn't allowed to see never leaves the database.
const getBySlugEffect = (
  type: AudioType,
  slug: string,
  mdx: MdxService,
  actor?: { userId: string; userRole: string },
) =>
  Effect.gen(function* () {
    const db = yield* Database

    return yield* findAudioBySlug(
      type,
      slug,
      mdx,
      and(
        eq(audioTable.type, type),
        eq(audioTable.slug, slug),
        audioVisibilityCondition(db, actor),
      ),
    )
  })

// Edit lookup: fetches unconditionally (any type+slug, draft or not) because
// the caller (getBySlugForEdit) runs requireCreatorOrAdmin right after --
// that authorization check, not a query filter, is what gates access here.
const getBySlugUnfilteredEffect = (type: AudioType, slug: string, mdx: MdxService) =>
  findAudioBySlug(type, slug, mdx, and(eq(audioTable.type, type), eq(audioTable.slug, slug)))

const createEffect = (
  data: CreateAudioData,
  creatorIds: Array<string>,
  { actorId, actorRole, idempotencyKey }: CreateAudioOptions,
  media: MediaPublication,
) =>
  Effect.gen(function* () {
    yield* validateCanonicalContent(data.content)
    yield* validateAudioArtists(data.artistIds)
    const db = yield* Database
    const idempotencyFingerprint = yield* createAudioFingerprint(data, creatorIds)

    // thumbnailUrl is intentionally left as-is (NULL when not provided): the
    // show's artwork is resolved at read time instead of copied here, so
    // episodes stay in sync when a show's art changes later.
    const publication = yield* media(data, {
      userId: actorId,
      userRole: actorRole ?? 'user',
      credential: undefined,
    })

    const { tags, artistIds, ...audioData } = publication.data
    const id = crypto.randomUUID()

    const result = yield* Effect.tryPromise({
      try: () =>
        timeQuery(async () => {
          await db.batch([
            db
              .insert(audioTable)
              .values({
                ...audioData,
                id,
                idempotencyKey,
                idempotencyActorId: actorId,
                idempotencyFingerprint,
              })
              .onConflictDoNothing(),
            ...creatorIds.map((creatorId) =>
              db.insert(audioCreators).select(
                db
                  .select({
                    audioId: audioTable.id,
                    creatorId: sql<string>`${creatorId}`.as('creatorId'),
                  })
                  .from(audioTable)
                  .where(
                    and(
                      eq(audioTable.id, id),
                      eq(audioTable.idempotencyActorId, actorId),
                      eq(audioTable.idempotencyKey, idempotencyKey),
                      eq(audioTable.idempotencyFingerprint, idempotencyFingerprint),
                    ),
                  ),
              ),
            ),
            ...[...new Set(artistIds)].map((artistId, position) =>
              db.insert(audioArtists).select(
                db
                  .select({
                    audioId: audioTable.id,
                    artistId: sql<string>`${artistId}`.as('artistId'),
                    position: sql<number>`${position}`.as('position'),
                  })
                  .from(audioTable)
                  .where(
                    and(
                      eq(audioTable.id, id),
                      eq(audioTable.idempotencyActorId, actorId),
                      eq(audioTable.idempotencyKey, idempotencyKey),
                      eq(audioTable.idempotencyFingerprint, idempotencyFingerprint),
                    ),
                  ),
              ),
            ),
          ])

          const rows = await db
            .select()
            .from(audioTable)
            .where(
              and(
                eq(audioTable.idempotencyActorId, actorId),
                eq(audioTable.idempotencyKey, idempotencyKey),
              ),
            )
            .limit(1)

          const audio = rows[0]

          if (!audio || audio.idempotencyFingerprint !== idempotencyFingerprint) {
            throw new AudioCreateConflict()
          }

          if (audio.id === id && tags !== undefined)
            await replaceEntityLabels(db, 'audio', audio.id, { tags })

          return { audio, created: audio.id === id }
        }, 'create-audio-batch'),
      catch: (error) => {
        const errorMessage = getErrorMessage(error)

        if (error instanceof AudioCreateConflict || errorMessage.includes('unique constraint')) {
          return new ConflictError({
            message: 'Audio with this slug already exists',
            resource: 'audio',
          })
        }

        if (errorMessage.includes('foreign key constraint')) {
          return new ConflictError({
            message: 'You may have entered a non-existent creator id',
            resource: 'audio',
          })
        }

        return new DatabaseError({
          message: `Failed to create audio: ${errorMessage}`,
          operation: 'transaction',
          table: 'audio',
        })
      },
    })

    yield* Effect.annotateCurrentSpan('audioId', result.audio.id)
    yield* Effect.annotateCurrentSpan('audioType', result.audio.type)
    yield* Effect.annotateCurrentSpan('creatorCount', creatorIds.length)
    yield* Effect.annotateCurrentSpan('idempotencyReplay', !result.created)

    if (result.created) {
      yield* recordAudioCreate

      yield* Effect.logInfo('[Content] Audio created', {
        audioId: result.audio.id,
        type: result.audio.type,
        title: result.audio.title,
        slug: result.audio.slug,
        creatorCount: creatorIds.length,
      })

      yield* markAttachedAssets('audio', result.audio.id, [
        result.audio.url,
        result.audio.thumbnailUrl,
      ])
    }

    const { tags: projectedTags } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'audio', result.audio),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })

    yield* publication.publish

    const [credited] = yield* projectAudioArtists([result.audio])

    return { ...result.audio, tags: projectedTags, artists: credited?.artists ?? [] }
  })

const updateEffect = (
  type: AudioType,
  slug: string,
  userId: string,
  userRole: string,
  data: Partial<InsertAudio> & { creatorIds?: Array<string> },
  mdx: MdxService,
  media: MediaPublication,
) =>
  Effect.gen(function* () {
    const db = yield* Database

    const existingRecords = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(audioTable)
          .where(and(eq(audioTable.type, type), eq(audioTable.slug, slug)))
          .limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to check audio existence: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'audio',
        }),
    })

    const existingAudio = existingRecords[0]

    if (!existingAudio) {
      return yield* new NotFoundError({
        message: 'Audio not found',
        resource: 'audio',
        id: slug,
      })
    }

    yield* requireCreatorOrAdmin('audio', existingAudio.id, userId, userRole)
    yield* validateCanonicalContent(data.content)
    yield* validateAudioArtists(data.artistIds)

    const publication = yield* media(
      data,
      { userId, userRole, credential: undefined },
      existingAudio,
    )

    const { creatorIds, tags, artistIds, ...updateData } = publication.data
    let updatedAudio = existingAudio

    if (Object.keys(updateData).length > 0 || artistIds !== undefined) {
      const updatedRecords = yield* Effect.tryPromise({
        try: () =>
          db
            .update(audioTable)
            .set({ ...updateData, updatedAt: new Date() })
            .where(eq(audioTable.id, existingAudio.id))
            .returning(),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to update audio: ${getErrorMessage(error)}`,
            operation: 'update',
            table: 'audio',
          }),
      })

      if (!updatedRecords[0]) {
        return yield* new DatabaseError({
          message: 'Failed to update audio',
          operation: 'update',
          table: 'audio',
        })
      }

      updatedAudio = updatedRecords[0]

      // An image/audio file attached via an edit form (not just at create
      // time) still needs its upload_assets row moved out of 'pending', or
      // it looks reclaimable to a future cleanup job despite being in use.
      yield* markAttachedAssets('audio', updatedAudio.id, [
        updatedAudio.url,
        updatedAudio.thumbnailUrl,
      ])
    }

    if (creatorIds && creatorIds.length > 0) {
      yield* Effect.tryPromise({
        try: () =>
          db.batch([
            db.delete(audioCreators).where(eq(audioCreators.audioId, updatedAudio.id)),
            db.insert(audioCreators).values(
              creatorIds.map((creatorId) => ({
                audioId: updatedAudio.id,
                creatorId,
              })),
            ),
          ]),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to update creators: ${getErrorMessage(error)}`,
            operation: 'transaction',
            table: 'audio_creators',
          }),
      })
    }

    if (artistIds !== undefined) yield* replaceAudioArtists(updatedAudio.id, artistIds)

    if (tags !== undefined) {
      yield* Effect.tryPromise({
        try: () => replaceEntityLabels(db, 'audio', updatedAudio.id, { tags }),
        catch: (error) =>
          new DatabaseError({
            message: getErrorMessage(error),
            operation: 'update',
            table: 'labels',
          }),
      })
    }

    yield* publication.publish

    const creatorRows = yield* Effect.tryPromise({
      try: () =>
        db.query.audioCreators.findMany({
          where: eq(audioCreators.audioId, updatedAudio.id),
          with: { creator: true },
        }),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch creators: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'audio_creators',
        }),
    })

    let compiledContent = ''
    const richContent = yield* mdx.render(updatedAudio.content)

    if (updatedAudio.content) {
      compiledContent = yield* mdx
        .compile(updatedAudio.content)
        .pipe(Effect.orElseSucceed(() => ''))
    }

    let showThumbnailUrl: string | null = null
    const showId = updatedAudio.showId

    if (!updatedAudio.thumbnailUrl && showId) {
      const show = yield* Effect.tryPromise({
        try: () =>
          db.query.showsTable.findFirst({
            where: eq(showsTable.id, showId),
            columns: { thumbnailUrl: true },
          }),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to fetch show: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'shows',
          }),
      })

      showThumbnailUrl = show?.thumbnailUrl ?? null
    }

    const { tags: projectedTags } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'audio', updatedAudio),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })

    const [credited] = yield* projectAudioArtists([updatedAudio])

    return {
      ...updatedAudio,
      artists: credited?.artists ?? [],
      tags: projectedTags,
      thumbnailUrl: updatedAudio.thumbnailUrl ?? showThumbnailUrl,
      compiledContent,
      richContent,
      creators: creatorRows.map(({ creator }) => ({
        id: creator.id,
        name: creator.name,
        username: creator.username,
      })),
    }
  })

const PLAY_DEDUP_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

const playDedupMap = new Map<string, number>()

const trackPlayEffect = (id: string, clientIp?: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const records = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: audioTable.id, playCount: audioTable.playCount })
          .from(audioTable)
          .where(and(eq(audioTable.id, id), eq(audioTable.draft, false)))
          .limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch audio: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'audio',
        }),
    })

    const audio = records[0]

    if (!audio) {
      return yield* new NotFoundError({
        message: 'Audio not found',
        resource: 'audio',
        id,
      })
    }

    if (clientIp) {
      const now = Date.now()

      for (const [key, expiresAt] of playDedupMap) {
        if (now >= expiresAt) playDedupMap.delete(key)
      }

      const dedupKey = `${clientIp}:${id}`

      if (playDedupMap.has(dedupKey)) {
        return { playCount: audio.playCount }
      }

      playDedupMap.set(dedupKey, now + PLAY_DEDUP_WINDOW_MS)
    }

    const updated = yield* Effect.tryPromise({
      try: () =>
        db
          .update(audioTable)
          .set({ playCount: sql`${audioTable.playCount} + 1` })
          .where(eq(audioTable.id, audio.id))
          .returning({ playCount: audioTable.playCount }),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to increment play count: ${getErrorMessage(error)}`,
          operation: 'update',
          table: 'audio',
        }),
    })

    return { playCount: updated[0]?.playCount ?? 0 }
  })

export const AudioServiceLayer = Layer.effect(
  AudioService,
  Effect.gen(function* () {
    const db = yield* Database
    const mdx = yield* MdxService
    const crypto = yield* Crypto.Crypto
    const config = yield* ConfigService
    const uploadAssetService = yield* UploadAssetService
    const store = yield* ObjectStoreClient
    const media = makeMediaPublication(config, store)
    const provideDb = Effect.provideService(Database, db)

    return {
      getByType: (type, options) =>
        provideDb(getByTypeEffect(type, options)).pipe(
          Effect.withSpan('audio.getByType', { attributes: { type } }),
        ),
      getByTypeForEdit: (type, options, userId, userRole) =>
        provideDb(getByTypeEffect(type, options, { userId, userRole })).pipe(
          Effect.withSpan('audio.getByTypeForEdit', { attributes: { type } }),
        ),
      getTags: (type) =>
        provideDb(getTagsEffect(type)).pipe(
          Effect.withSpan('audio.getTags', { attributes: { type } }),
        ),
      getBySlug: (type, slug, actor) =>
        provideDb(getBySlugEffect(type, slug, mdx, actor)).pipe(
          Effect.withSpan('audio.getBySlug', { attributes: { type, slug } }),
        ),
      getBySlugForEdit: (type, slug, userId, userRole) =>
        provideDb(
          Effect.gen(function* () {
            const audio = yield* getBySlugUnfilteredEffect(type, slug, mdx)
            yield* requireCreatorOrAdmin('audio', audio.id, userId, userRole)

            return audio
          }),
        ).pipe(Effect.withSpan('audio.getBySlugForEdit', { attributes: { type, slug } })),
      create: (data, creatorIds, options) =>
        provideDb(createEffect(data, creatorIds, options, media)).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.provideService(ConfigService, config),
          Effect.provideService(UploadAssetService, uploadAssetService),
          Effect.withSpan('audio.create'),
        ),
      update: (type, slug, userId, userRole, data) =>
        provideDb(updateEffect(type, slug, userId, userRole, data, mdx, media)).pipe(
          Effect.provideService(ConfigService, config),
          Effect.provideService(UploadAssetService, uploadAssetService),
          Effect.withSpan('audio.update', { attributes: { type, slug } }),
        ),
      trackPlay: (id, clientIp) =>
        provideDb(trackPlayEffect(id, clientIp)).pipe(
          Effect.withSpan('audio.trackPlay', { attributes: { id } }),
        ),
    }
  }),
).pipe(Layer.provide(CryptoLive))
