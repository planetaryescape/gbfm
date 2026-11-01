import { and, eq, exists, lte } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { projectEntityLabels, replaceEntityLabels } from '@/db/labels'
import { Database } from '@/db/layer'
import { musicLabelsTable } from '@/db/music-entity.schema'
import {
  type InsertRelease,
  releasesTable,
  type SelectMdxCompiledRelease,
  type SelectRelease,
} from '@/db/release.schema'
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
import { ConfigService } from '@/services/config.service'
import { makeMediaPublication, type MediaPublication } from '@/services/media-publication'
import { ObjectStoreClient } from '@/services/storage/object-store-client'

export interface ReleaseService {
  readonly getBySlug: (
    slug: string,
  ) => Effect.Effect<SelectMdxCompiledRelease, DatabaseError | NotFoundError>
  readonly getBySlugForEdit: (
    slug: string,
    userId: string,
    userRole: string,
  ) => Effect.Effect<SelectMdxCompiledRelease, DatabaseError | NotFoundError | UnauthorizedError>
  readonly create: (
    data: InsertRelease & { releaseDate: Date },
    userId: string,
    userRole: string,
  ) => Effect.Effect<
    SelectRelease,
    DatabaseError | NotFoundError | ConflictError | UnauthorizedError | ValidationError | S3Error
  >
  readonly update: (
    slug: string,
    userId: string,
    userRole: string,
    data: Partial<InsertRelease> & { releaseDate?: Date },
  ) => Effect.Effect<
    SelectMdxCompiledRelease,
    DatabaseError | NotFoundError | UnauthorizedError | ValidationError | S3Error
  >
  readonly delete: (
    slug: string,
    userId: string,
    userRole: string,
  ) => Effect.Effect<void, DatabaseError | NotFoundError | UnauthorizedError>
}

export const ReleaseService = Context.Service<ReleaseService>('ReleaseService')

const getBySlugEffect = (slug: string, includeDrafts = false) =>
  Effect.gen(function* () {
    const db = yield* Database

    const releaseRecords = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(releasesTable)
          .where(
            includeDrafts
              ? eq(releasesTable.slug, slug)
              : and(
                  eq(releasesTable.slug, slug),
                  eq(releasesTable.draft, false),
                  exists(
                    db
                      .select({ id: musicLabelsTable.id })
                      .from(musicLabelsTable)
                      .where(
                        and(
                          eq(musicLabelsTable.id, releasesTable.labelId),
                          lte(musicLabelsTable.publishedAt, new Date()),
                        ),
                      ),
                  ),
                ),
          )
          .limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch release: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'releases',
        }),
    })

    const release = releaseRecords[0]

    if (!release) {
      return yield* new NotFoundError({
        message: 'Release not found',
        resource: 'release',
        id: slug,
      })
    }

    const { tags } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'release', release),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })

    const mdx = yield* MdxService

    const [compiledContent, richContent] = yield* Effect.all([
      release.content
        ? mdx.compile(release.content).pipe(Effect.orElseSucceed(() => ''))
        : Effect.succeed(''),
      mdx.render(release.content),
    ])

    return {
      ...release,
      tags,
      compiledContent,
      richContent,
    } satisfies SelectMdxCompiledRelease
  })

const createEffect = (
  data: InsertRelease & { releaseDate: Date },
  userId: string,
  userRole: string,
  media: MediaPublication,
) =>
  Effect.gen(function* () {
    yield* validateCanonicalContent(data.content)
    const db = yield* Database
    const publication = yield* media(data, { userId, userRole, credential: undefined })
    const { tags, ...releaseData } = publication.data

    const labelRecords = yield* Effect.tryPromise({
      try: () =>
        db.select().from(musicLabelsTable).where(eq(musicLabelsTable.id, data.labelId)).limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to fetch label: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'music_labels',
        }),
    })

    const label = labelRecords[0]

    if (!label) {
      return yield* new NotFoundError({
        message: 'Label not found',
        resource: 'label',
        id: data.labelId,
      })
    }

    yield* requireCreatorOrAdmin('label', label.id, userId, userRole)

    const insertedRecords = yield* Effect.tryPromise({
      try: () =>
        db
          .insert(releasesTable)
          .values({
            ...releaseData,
            releaseDate: data.releaseDate,
          })
          .returning(),
      catch: (error) => {
        const errorMessage = getErrorMessage(error)

        if (errorMessage.includes('unique constraint')) {
          return new ConflictError({
            message: 'Release with this slug already exists',
            resource: 'release',
          })
        }

        return new DatabaseError({
          message: `Failed to create release: ${errorMessage}`,
          operation: 'insert',
          table: 'releases',
        })
      },
    })

    const newRelease = insertedRecords[0]

    if (!newRelease) {
      return yield* new DatabaseError({
        message: 'Failed to create release',
        operation: 'insert',
        table: 'releases',
      })
    }

    if (tags !== undefined) {
      yield* Effect.tryPromise({
        try: () => replaceEntityLabels(db, 'release', newRelease.id, { tags }),
        catch: (error) =>
          new DatabaseError({
            message: getErrorMessage(error),
            operation: 'insert',
            table: 'labels',
          }),
      })
    }

    yield* publication.publish

    return yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'release', newRelease),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })
  })

const updateEffect = (
  slug: string,
  userId: string,
  userRole: string,
  data: Partial<InsertRelease> & { releaseDate?: Date },
  media: MediaPublication,
) =>
  Effect.gen(function* () {
    const db = yield* Database

    const existingRecords = yield* Effect.tryPromise({
      try: () => db.select().from(releasesTable).where(eq(releasesTable.slug, slug)).limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to check release existence: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'releases',
        }),
    })

    const existingRelease = existingRecords[0]

    if (!existingRelease) {
      return yield* new NotFoundError({
        message: 'Release not found',
        resource: 'release',
        id: slug,
      })
    }

    yield* requireCreatorOrAdmin('label', existingRelease.labelId, userId, userRole)
    yield* validateCanonicalContent(data.content)

    const publication = yield* media(
      data,
      { userId, userRole, credential: undefined },
      existingRelease,
    )

    const { tags, ...releaseData } = publication.data

    if (data.labelId && data.labelId !== existingRelease.labelId) {
      const destinationLabelId = data.labelId

      const destinationLabels = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(musicLabelsTable)
            .where(eq(musicLabelsTable.id, destinationLabelId))
            .limit(1),
        catch: (error) =>
          new DatabaseError({
            message: `Failed to fetch destination label: ${getErrorMessage(error)}`,
            operation: 'select',
            table: 'music_labels',
          }),
      })

      const destinationLabel = destinationLabels[0]

      if (!destinationLabel) {
        return yield* new NotFoundError({
          message: 'Label not found',
          resource: 'label',
          id: data.labelId,
        })
      }

      yield* requireCreatorOrAdmin('label', destinationLabel.id, userId, userRole)
    }

    const updatedRecords = yield* Effect.tryPromise({
      try: () =>
        db
          .update(releasesTable)
          .set({
            ...releaseData,
            updatedAt: new Date(),
            releaseDate: data.releaseDate ?? existingRelease.releaseDate,
          })
          .where(eq(releasesTable.id, existingRelease.id))
          .returning(),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to update release: ${getErrorMessage(error)}`,
          operation: 'update',
          table: 'releases',
        }),
    })

    const updatedRelease = updatedRecords[0]

    if (!updatedRelease) {
      return yield* new DatabaseError({
        message: 'Failed to update release',
        operation: 'update',
        table: 'releases',
      })
    }

    if (tags !== undefined) {
      yield* Effect.tryPromise({
        try: () => replaceEntityLabels(db, 'release', updatedRelease.id, { tags }),
        catch: (error) =>
          new DatabaseError({
            message: getErrorMessage(error),
            operation: 'update',
            table: 'labels',
          }),
      })
    }

    yield* publication.publish

    const { tags: projectedTags } = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'release', updatedRelease),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })

    const mdx = yield* MdxService

    const [compiledContent, richContent] = yield* Effect.all([
      updatedRelease.content
        ? mdx.compile(updatedRelease.content).pipe(Effect.orElseSucceed(() => ''))
        : Effect.succeed(''),
      mdx.render(updatedRelease.content),
    ])

    return {
      ...updatedRelease,
      tags: projectedTags,
      compiledContent,
      richContent,
    } satisfies SelectMdxCompiledRelease
  })

const deleteEffect = (slug: string, userId: string, userRole: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const existingRecords = yield* Effect.tryPromise({
      try: () => db.select().from(releasesTable).where(eq(releasesTable.slug, slug)).limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to check release existence: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'releases',
        }),
    })

    const existingRelease = existingRecords[0]

    if (!existingRelease) {
      return yield* new NotFoundError({
        message: 'Release not found',
        resource: 'release',
        id: slug,
      })
    }

    yield* requireCreatorOrAdmin('label', existingRelease.labelId, userId, userRole)

    yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db
            .delete(entityLabelsTable)
            .where(
              and(
                eq(entityLabelsTable.entityType, 'release'),
                eq(entityLabelsTable.entityId, existingRelease.id),
              ),
            ),
          db.delete(releasesTable).where(eq(releasesTable.id, existingRelease.id)),
        ]),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to delete release: ${getErrorMessage(error)}`,
          operation: 'delete',
          table: 'releases',
        }),
    })

    return undefined
  })

export const ReleaseServiceLayer = Layer.effect(
  ReleaseService,
  Effect.gen(function* () {
    const db = yield* Database
    const mdx = yield* MdxService
    const config = yield* ConfigService
    const store = yield* ObjectStoreClient
    const media = makeMediaPublication(config, store)
    const provideDb = Effect.provideService(Database, db)

    return {
      getBySlug: (slug) =>
        provideDb(getBySlugEffect(slug).pipe(Effect.provideService(MdxService, mdx))).pipe(
          Effect.withSpan('release.getBySlug', { attributes: { slug } }),
        ),
      getBySlugForEdit: (slug, userId, userRole) =>
        provideDb(
          Effect.gen(function* () {
            const release = yield* getBySlugEffect(slug, true)
            yield* requireCreatorOrAdmin('label', release.labelId, userId, userRole)

            return release
          }).pipe(Effect.provideService(MdxService, mdx)),
        ).pipe(Effect.withSpan('release.getBySlugForEdit', { attributes: { slug } })),
      create: (data, userId, userRole) =>
        provideDb(createEffect(data, userId, userRole, media)).pipe(
          Effect.withSpan('release.create'),
        ),
      update: (slug, userId, userRole, data) =>
        provideDb(
          updateEffect(slug, userId, userRole, data, media).pipe(
            Effect.provideService(MdxService, mdx),
          ),
        ).pipe(Effect.withSpan('release.update', { attributes: { slug } })),
      delete: (slug, userId, userRole) =>
        provideDb(deleteEffect(slug, userId, userRole)).pipe(
          Effect.withSpan('release.delete', { attributes: { slug } }),
        ),
    }
  }),
)
