import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { audioArtists, audioTable, type SelectAudio } from '@/db/audio.schema'
import { showIdsForCreator } from '@/db/creator-membership'
import { decodeEntityTags, entityTagsProjection } from '@/db/entity-label-projection'
import { projectEntityLabels, replaceEntityLabels } from '@/db/labels'
import { Database } from '@/db/layer'
import {
  type InsertShow,
  type SelectMdxCompiledShow,
  type SelectShow,
  showCreators,
  showsTable,
} from '@/db/show.schema'
import { entityLabelsTable } from '@/db/tags.schema'
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
import { MdxService, validateCanonicalContent } from '@/lib/mdx'
import { createPaginationMetadata, type PaginationMetadata } from '@/lib/pagination'
import { ConfigService } from '@/services/config.service'
import {
  makeMediaPublication,
  type MediaActor,
  type MediaPublication,
} from '@/services/media-publication'
import { ObjectStoreClient } from '@/services/storage/object-store-client'

import { artistCredits } from './audio-artists'

export { ShowSubscriptionService, ShowSubscriptionServiceLayer } from './show-subscription.service'

type ShowWithHosts = SelectShow & {
  hosts: Array<{ id: string; name: string; username: string | null }>
}

/** Non-rendering public show metadata; no media, host graph or personalized state. */
export type PublicShowSummary = Pick<
  SelectShow,
  'id' | 'slug' | 'title' | 'description' | 'createdAt' | 'updatedAt'
>

export interface ShowService {
  /** Missing and draft shows are indistinguishable; never renders or resolves embeds. */
  readonly getPublicSummaryBySlug: (
    slug: string,
  ) => Effect.Effect<PublicShowSummary, DatabaseError | NotFoundError>
  readonly getNavigationShows: Effect.Effect<Array<ShowWithHosts>, DatabaseError>
  readonly getEpisodesForShow: (
    show: SelectMdxCompiledShow,
    options: { limit: number; offset: number },
    actor?: { userId: string; userRole: string },
  ) => Effect.Effect<
    { data: Array<SelectAudio>; pagination: PaginationMetadata },
    DatabaseError | NotFoundError
  >
  readonly getAll: (options: {
    limit: number
    offset: number
  }) => Effect.Effect<{ data: Array<ShowWithHosts>; pagination: PaginationMetadata }, DatabaseError>
  readonly getAllForEdit: (
    options: { limit: number; offset: number },
    userId: string,
    userRole: string,
  ) => Effect.Effect<{ data: Array<ShowWithHosts>; pagination: PaginationMetadata }, DatabaseError>
  readonly getBySlug: (
    slug: string,
  ) => Effect.Effect<SelectMdxCompiledShow, DatabaseError | NotFoundError>
  readonly getBySlugForEdit: (
    slug: string,
    userId: string,
    userRole: string,
  ) => Effect.Effect<SelectMdxCompiledShow, DatabaseError | NotFoundError | UnauthorizedError>
  readonly create: (
    data: InsertShow,
    hostIds: Array<string>,
    actor?: MediaActor,
  ) => Effect.Effect<
    SelectShow,
    DatabaseError | ConflictError | ValidationError | UnauthorizedError | S3Error
  >
  readonly update: (
    slug: string,
    userId: string,
    userRole: string,
    data: Partial<InsertShow> & { hostIds?: Array<string> },
  ) => Effect.Effect<
    SelectMdxCompiledShow,
    DatabaseError | NotFoundError | UnauthorizedError | ValidationError | S3Error
  >
  readonly delete: (
    slug: string,
    userId: string,
    userRole: string,
  ) => Effect.Effect<void, DatabaseError | NotFoundError | UnauthorizedError>
  readonly getEpisodes: (
    showSlug: string,
    options: { limit: number; offset: number },
    actor?: { userId: string; userRole: string },
  ) => Effect.Effect<
    {
      data: Array<SelectAudio>
      pagination: PaginationMetadata
    },
    DatabaseError | NotFoundError
  >
}

export const ShowService = Context.Service<ShowService>('ShowService')

const getAllEffect = (
  options: { limit: number; offset: number },
  actor?: { userId: string; userRole: string },
  includeCount = true,
) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { limit, offset } = options

    const whereCondition = actor
      ? actor.userRole === 'admin'
        ? undefined
        : showIdsForCreator(db, actor.userId)
      : eq(showsTable.draft, false)

    const [countResult, shows] = yield* Effect.all(
      [
        includeCount
          ? Effect.tryPromise({
              try: () => db.select({ total: count() }).from(showsTable).where(whereCondition),
              catch: (error) =>
                new DatabaseError({
                  message: `Failed to count shows: ${getErrorMessage(error)}`,
                  operation: 'select',
                  table: 'shows',
                }),
            }).pipe(Effect.withSpan('show.getAll.count'))
          : Effect.succeed([]),
        Effect.tryPromise({
          try: async () => {
            const shows = await db.query.showsTable.findMany({
              where: whereCondition,
              extras: (show) => ({ tagsJson: entityTagsProjection('show', show.id) }),
              limit,
              offset,
              orderBy: [desc(showsTable.createdAt), asc(showsTable.title)],
              with: {
                showCreators: {
                  with: { creator: true },
                },
              },
            })

            return shows.map(({ tagsJson, ...show }) => ({
              ...show,
              tags: decodeEntityTags(tagsJson),
            }))
          },
          catch: (error) =>
            new DatabaseError({
              message: `Failed to fetch shows: ${getErrorMessage(error)}`,
              operation: 'select',
              table: 'shows',
            }),
        }).pipe(Effect.withSpan('show.getAll.list')),
      ],
      { concurrency: 'unbounded' },
    )

    const total = countResult[0]?.total ?? 0

    yield* Effect.annotateCurrentSpan({ resultCount: shows.length, totalCount: total })

    const data = shows.map(({ showCreators: hosts, ...show }) => ({
      ...show,
      hosts: hosts.map(({ creator }) => ({
        id: creator.id,
        name: creator.name,
        username: creator.username,
      })),
    }))

    return {
      data,
      pagination: createPaginationMetadata(total, limit, offset),
    }
  })

const getBySlugEffect = (slug: string, includeDrafts = false) =>
  Effect.gen(function* () {
    const db = yield* Database

    const show = yield* Effect.tryPromise({
      try: async () => {
        const show = await db.query.showsTable.findFirst({
          where: includeDrafts
            ? eq(showsTable.slug, slug)
            : and(eq(showsTable.slug, slug), eq(showsTable.draft, false)),
          extras: (show) => ({ tagsJson: entityTagsProjection('show', show.id) }),
          with: {
            showCreators: {
              with: { creator: true },
            },
          },
        })

        if (!show) return undefined

        const { tagsJson, ...fields } = show

        return { ...fields, tags: decodeEntityTags(tagsJson) }
      },
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch show: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'shows',
        }),
    })

    if (!show) {
      return yield* new NotFoundError({
        message: 'Show not found',
        resource: 'show',
        id: slug,
      })
    }

    const { showCreators: hosts, ...showFields } = show

    const mdx = yield* MdxService

    const [compiledContent, richContent] = yield* Effect.all([
      show.content
        ? mdx.compile(show.content).pipe(Effect.orElseSucceed(() => ''))
        : Effect.succeed(''),
      mdx.render(show.content),
    ])

    return {
      ...showFields,
      compiledContent,
      richContent,
      hosts: hosts.map(({ creator }) => ({
        id: creator.id,
        name: creator.name,
        username: creator.username,
      })),
    } satisfies SelectMdxCompiledShow
  })

const createEffect = (
  data: InsertShow,
  hostIds: Array<string>,
  media: MediaPublication,
  actor?: MediaActor,
) =>
  Effect.gen(function* () {
    yield* validateCanonicalContent(data.content)
    const db = yield* Database
    const publication = yield* media(data, actor)
    const { tags, ...showData } = publication.data
    const id = crypto.randomUUID()

    const result = yield* Effect.tryPromise({
      try: async () => {
        await db.batch([
          db.insert(showsTable).values({ ...showData, id }),
          ...(hostIds.length > 0
            ? [
                db
                  .insert(showCreators)
                  .values(hostIds.map((creatorId) => ({ showId: id, creatorId }))),
              ]
            : []),
        ])
        const rows = await db.select().from(showsTable).where(eq(showsTable.id, id)).limit(1)
        const show = rows[0]

        if (!show) throw new Error('Failed to create show')

        if (tags !== undefined) await replaceEntityLabels(db, 'show', show.id, { tags })

        return show
      },
      catch: (error) => {
        const errorMessage = getErrorMessage(error)

        if (errorMessage.includes('unique constraint')) {
          return new ConflictError({
            message: 'Show with this slug already exists',
            resource: 'show',
          })
        }

        if (errorMessage.includes('foreign key constraint')) {
          return new ConflictError({
            message: 'You may have entered a non-existent host id',
            resource: 'show',
          })
        }

        return new DatabaseError({
          message: `Failed to create show: ${errorMessage}`,
          operation: 'transaction',
          table: 'shows',
        })
      },
    })

    const { tags: projectedTags } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'show', result),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })

    yield* publication.publish

    return { ...result, tags: projectedTags }
  })

const updateEffect = (
  slug: string,
  userId: string,
  userRole: string,
  data: Partial<InsertShow> & { hostIds?: Array<string> },
  media: MediaPublication,
) =>
  Effect.gen(function* () {
    const db = yield* Database

    const existingRecords = yield* Effect.tryPromise({
      try: () => db.select().from(showsTable).where(eq(showsTable.slug, slug)).limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to check show existence: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'shows',
        }),
    })

    const existingShow = existingRecords[0]

    if (!existingShow) {
      return yield* new NotFoundError({
        message: 'Show not found',
        resource: 'show',
        id: slug,
      })
    }

    yield* requireCreatorOrAdmin('show', existingShow.id, userId, userRole)
    yield* validateCanonicalContent(data.content)

    const publication = yield* media(
      data,
      { userId, userRole, credential: undefined },
      existingShow,
    )

    const { hostIds, tags, ...updateData } = publication.data

    const updatedRecords = yield* Effect.tryPromise({
      try: async () => {
        const update = db
          .update(showsTable)
          .set({ ...updateData, updatedAt: new Date() })
          .where(eq(showsTable.id, existingShow.id))

        if (hostIds) {
          await db.batch([
            update,
            db.delete(showCreators).where(eq(showCreators.showId, existingShow.id)),
            ...(hostIds.length > 0
              ? [
                  db
                    .insert(showCreators)
                    .values(hostIds.map((creatorId) => ({ showId: existingShow.id, creatorId }))),
                ]
              : []),
          ])
        } else {
          await db.batch([update])
        }

        return db.select().from(showsTable).where(eq(showsTable.id, existingShow.id)).limit(1)
      },
      catch: (error) =>
        new DatabaseError({
          message: `Failed to update show: ${getErrorMessage(error)}`,
          operation: 'update',
          table: 'shows',
        }),
    })

    const updatedShow = updatedRecords[0]

    if (!updatedShow) {
      return yield* new DatabaseError({
        message: 'Failed to update show',
        operation: 'update',
        table: 'shows',
      })
    }

    if (tags !== undefined) {
      yield* Effect.tryPromise({
        try: () => replaceEntityLabels(db, 'show', updatedShow.id, { tags }),
        catch: (error) =>
          new DatabaseError({
            message: getErrorMessage(error),
            operation: 'update',
            table: 'labels',
          }),
      })
    }

    yield* publication.publish

    const hostRows = yield* Effect.tryPromise({
      try: () =>
        db.query.showCreators.findMany({
          where: eq(showCreators.showId, updatedShow.id),
          with: { creator: true },
        }),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch hosts: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'show_creators',
        }),
    })

    const { tags: projectedTags } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'show', updatedShow),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })

    const mdx = yield* MdxService

    const [compiledContent, richContent] = yield* Effect.all([
      updatedShow.content
        ? mdx.compile(updatedShow.content).pipe(Effect.orElseSucceed(() => ''))
        : Effect.succeed(''),
      mdx.render(updatedShow.content),
    ])

    return {
      ...updatedShow,
      tags: projectedTags,
      compiledContent,
      richContent,
      hosts: hostRows.map(({ creator }) => ({
        id: creator.id,
        name: creator.name,
        username: creator.username,
      })),
    } satisfies SelectMdxCompiledShow
  })

const deleteEffect = (slug: string, userId: string, userRole: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const existingRecords = yield* Effect.tryPromise({
      try: () => db.select().from(showsTable).where(eq(showsTable.slug, slug)).limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to check show existence: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'shows',
        }),
    })

    const existingShow = existingRecords[0]

    if (!existingShow) {
      return yield* new NotFoundError({
        message: 'Show not found',
        resource: 'show',
        id: slug,
      })
    }

    yield* requireCreatorOrAdmin('show', existingShow.id, userId, userRole)

    yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db
            .delete(entityLabelsTable)
            .where(
              and(
                eq(entityLabelsTable.entityType, 'show'),
                eq(entityLabelsTable.entityId, existingShow.id),
              ),
            ),
          db.delete(showsTable).where(eq(showsTable.id, existingShow.id)),
        ]),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to delete show: ${getErrorMessage(error)}`,
          operation: 'delete',
          table: 'shows',
        }),
    })

    return undefined
  })

const getEpisodesEffect = (
  showSlug: string,
  options: { limit: number; offset: number },
  actor?: { userId: string; userRole: string },
  loadedShow?: SelectMdxCompiledShow,
) =>
  Effect.gen(function* () {
    if (loadedShow?.draft)
      return yield* new NotFoundError({ message: 'Show not found', resource: 'show', id: showSlug })

    const db = yield* Database
    const { limit, offset } = options

    const draftCondition = actor?.userRole === 'admin' ? undefined : eq(audioTable.draft, false)

    const publishedShow = db
      .select({ id: showsTable.id })
      .from(showsTable)
      .where(and(eq(showsTable.slug, showSlug), eq(showsTable.draft, false)))
      .limit(1)

    const whereCondition = and(
      loadedShow ? eq(audioTable.showId, loadedShow.id) : inArray(audioTable.showId, publishedShow),
      draftCondition,
    )

    const [showRecords, countResult, episodes] = yield* Effect.all(
      [
        loadedShow
          ? Effect.succeed([{ id: loadedShow.id }])
          : Effect.tryPromise({
              try: () => publishedShow,
              catch: (error) =>
                new DatabaseError({
                  message: `Failed to fetch show: ${getErrorMessage(error)}`,
                  operation: 'select',
                  table: 'shows',
                }),
            }),
        Effect.tryPromise({
          try: () => db.select({ total: count() }).from(audioTable).where(whereCondition),
          catch: (error) =>
            new DatabaseError({
              message: `Failed to count episodes: ${getErrorMessage(error)}`,
              operation: 'select',
              table: 'audio',
            }),
        }),
        Effect.tryPromise({
          try: async () => {
            const episodes = await db.query.audioTable.findMany({
              where: whereCondition,
              extras: (audio) => ({ tagsJson: entityTagsProjection('audio', audio.id) }),
              limit,
              offset,
              orderBy: [desc(audioTable.createdAt), desc(audioTable.id)],
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
            })

            return episodes.map(({ tagsJson, ...episode }) => ({
              ...episode,
              tags: decodeEntityTags(tagsJson),
            }))
          },
          catch: (error) =>
            new DatabaseError({
              message: `Failed to fetch episodes: ${getErrorMessage(error)}`,
              operation: 'select',
              table: 'audio',
            }),
        }),
      ],
      { concurrency: 'unbounded' },
    )

    if (!showRecords[0]) {
      return yield* new NotFoundError({
        message: 'Show not found',
        resource: 'show',
        id: showSlug,
      })
    }

    const total = countResult[0]?.total ?? 0

    const data = episodes.map(
      ({ audioCreators: creators, audioArtists: credits, show: episodeShow, ...episode }) => ({
        ...episode,
        artists: artistCredits(credits),
        thumbnailUrl: episode.thumbnailUrl ?? episodeShow?.thumbnailUrl ?? null,
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

export const ShowServiceLayer = Layer.effect(
  ShowService,
  Effect.gen(function* () {
    const db = yield* Database
    const mdx = yield* MdxService
    const config = yield* ConfigService
    const store = yield* ObjectStoreClient
    const media = makeMediaPublication(config, store)
    const provideDb = Effect.provideService(Database, db)

    return {
      getPublicSummaryBySlug: (slug) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () =>
              db
                .select({
                  id: showsTable.id,
                  slug: showsTable.slug,
                  title: showsTable.title,
                  description: showsTable.description,
                  createdAt: showsTable.createdAt,
                  updatedAt: showsTable.updatedAt,
                })
                .from(showsTable)
                .where(and(eq(showsTable.slug, slug), eq(showsTable.draft, false)))
                .limit(1),
            catch: () =>
              new DatabaseError({
                message: 'Failed to read public show metadata',
                operation: 'select',
                table: 'shows',
              }),
          })

          if (!rows[0])
            return yield* new NotFoundError({
              message: 'Show not found',
              resource: 'show',
              id: slug,
            })

          return rows[0]
        }).pipe(Effect.withSpan('show.getPublicSummaryBySlug')),
      getEpisodesForShow: (show, options, actor) =>
        provideDb(getEpisodesEffect(show.slug, options, actor, show)).pipe(
          Effect.withSpan('show.getEpisodesForShow', { attributes: { showId: show.id } }),
        ),
      getNavigationShows: provideDb(getAllEffect({ limit: 100, offset: 0 }, undefined, false)).pipe(
        Effect.map((result) => result.data),
        Effect.withSpan('show.getNavigationShows'),
      ),
      getAll: (options) =>
        provideDb(getAllEffect(options)).pipe(
          Effect.withSpan('show.getAll', {
            attributes: { limit: options.limit, offset: options.offset },
          }),
        ),
      getAllForEdit: (options, userId, userRole) =>
        provideDb(getAllEffect(options, { userId, userRole })).pipe(
          Effect.withSpan('show.getAllForEdit', {
            attributes: { limit: options.limit, offset: options.offset },
          }),
        ),
      getBySlug: (slug) =>
        provideDb(getBySlugEffect(slug).pipe(Effect.provideService(MdxService, mdx))).pipe(
          Effect.withSpan('show.getBySlug', { attributes: { slug } }),
        ),
      getBySlugForEdit: (slug, userId, userRole) =>
        provideDb(
          Effect.gen(function* () {
            const show = yield* getBySlugEffect(slug, true)
            yield* requireCreatorOrAdmin('show', show.id, userId, userRole)

            return show
          }).pipe(Effect.provideService(MdxService, mdx)),
        ).pipe(Effect.withSpan('show.getBySlugForEdit', { attributes: { slug } })),
      create: (data, hostIds, actor) =>
        provideDb(createEffect(data, hostIds, media, actor)).pipe(Effect.withSpan('show.create')),
      update: (slug, userId, userRole, data) =>
        provideDb(
          updateEffect(slug, userId, userRole, data, media).pipe(
            Effect.provideService(MdxService, mdx),
          ),
        ).pipe(Effect.withSpan('show.update', { attributes: { slug } })),
      delete: (slug, userId, userRole) =>
        provideDb(deleteEffect(slug, userId, userRole)).pipe(
          Effect.withSpan('show.delete', { attributes: { slug } }),
        ),
      getEpisodes: (showSlug, options, actor) =>
        provideDb(getEpisodesEffect(showSlug, options, actor)).pipe(
          Effect.withSpan('show.getEpisodes', { attributes: { showSlug } }),
        ),
    }
  }),
)
