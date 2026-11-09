import { and, asc, desc, eq, lte } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { user as usersTable } from '@/db/auth.schema'
import { projectEntityLabels, projectEntityLabelsForRows } from '@/db/labels'
import { Database } from '@/db/layer'
import {
  musicLabelCreatorsTable,
  musicLabelsTable,
  type SelectMdxCompiledMusicLabel,
  type SelectMusicLabel,
} from '@/db/music-entity.schema'
import { DatabaseError, getErrorMessage } from '@/errors'
import { MdxService, validateCanonicalContent } from '@/lib/mdx'
import { omitUndefined } from '@/lib/omit-undefined'

import { insertMusicEntity } from './create-statements'
import { deleteMusicEntity } from './delete-write'
import { MusicMetadataRow, writeMusicMetadata } from './metadata-write'
import { requireInserted, requireOne } from './shared'
import { MusicWriteError, type MusicWriteRequest } from './write-intent'

export interface CreateLabelInput {
  name: string
  description?: string | null
  imageUrl?: string | null
  bannerImageUrl?: string | null
  slug: string
  content: string
  tags?: Array<string> | null
  genres?: Array<string> | null
  publishedAt?: Date | null
  createdById?: string | null
}

export const createLabelEffect = Effect.fn('musicEntity.createLabel')(function* (
  data: CreateLabelInput,
) {
  yield* validateCanonicalContent(data.content)
  const db = yield* Database
  const id = crypto.randomUUID()

  const rows = yield* Effect.tryPromise({
    try: async () => {
      await insertMusicEntity(db, { entityType: 'label', data, attribution: 'creator' }, id)

      const rows = await db
        .select()
        .from(musicLabelsTable)
        .where(eq(musicLabelsTable.id, id))
        .limit(1)

      return rows
    },
    catch: (error) =>
      new DatabaseError({
        message: `Failed to create label: ${getErrorMessage(error)}`,
        operation: 'insert',
        table: 'music_labels',
      }),
  })

  const label = yield* requireInserted(rows, 'music_labels')

  return yield* Effect.tryPromise({
    try: () => projectEntityLabels(db, 'musicLabel', label),
    catch: (error) =>
      new DatabaseError({ message: getErrorMessage(error), operation: 'select', table: 'labels' }),
  })
})

export const getLabelsEffect = (includeDrafts: boolean) =>
  Effect.gen(function* () {
    const db = yield* Database

    return yield* Effect.tryPromise({
      try: async () => {
        const labels = await db
          .select()
          .from(musicLabelsTable)
          .where(includeDrafts ? undefined : lte(musicLabelsTable.publishedAt, new Date()))
          .orderBy(desc(musicLabelsTable.createdAt), asc(musicLabelsTable.id))

        return projectEntityLabelsForRows(db, 'musicLabel', labels)
      },
      catch: (error) =>
        new DatabaseError({
          message: `Failed to list labels: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'music_labels',
        }),
    })
  }).pipe(Effect.withSpan('musicEntity.getLabels'))

export const getLabelByIdEffect = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(musicLabelsTable).where(eq(musicLabelsTable.id, id)).limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to get label: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'music_labels',
        }),
    })

    const label = yield* requireOne(rows, 'MusicLabel', id)

    return yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'musicLabel', label),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })
  }).pipe(Effect.withSpan('musicEntity.getLabelById', { attributes: { id } }))

export const getLabelBySlugEffect = (slug: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(musicLabelsTable)
          .where(
            and(eq(musicLabelsTable.slug, slug), lte(musicLabelsTable.publishedAt, new Date())),
          )
          .limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to get label: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'music_labels',
        }),
    })

    const label = yield* requireOne(rows, 'MusicLabel', slug)

    const projectedLabel = yield* Effect.tryPromise({
      try: () => projectEntityLabels(db, 'musicLabel', label),
      catch: (error) =>
        new DatabaseError({
          message: getErrorMessage(error),
          operation: 'select',
          table: 'labels',
        }),
    })

    const creators = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(musicLabelCreatorsTable)
          .innerJoin(usersTable, eq(musicLabelCreatorsTable.creatorId, usersTable.id))
          .where(eq(musicLabelCreatorsTable.labelId, label.id)),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to get label creators: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'music_label_creators',
        }),
    })

    const mdx = yield* MdxService

    const [compiledContent, richContent] = yield* Effect.all([
      projectedLabel.content
        ? mdx.compile(projectedLabel.content).pipe(Effect.orElseSucceed(() => ''))
        : Effect.succeed(''),
      mdx.render(projectedLabel.content),
    ])

    return {
      ...projectedLabel,
      compiledContent,
      richContent,
      creators,
    } satisfies SelectMdxCompiledMusicLabel
  }).pipe(Effect.withSpan('musicEntity.getLabelBySlug', { attributes: { slug } }))

const LabelWriteRow = Schema.Struct({
  ...MusicMetadataRow.fields,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(Schema.String),
  bannerImageUrl: Schema.NullOr(Schema.String),
  content: Schema.String,
  tags: Schema.NullOr(Schema.Array(Schema.String)),
  genres: Schema.NullOr(Schema.Array(Schema.String)),
})

const LabelWritePatch = Schema.Struct({
  name: Schema.optionalKey(LabelWriteRow.fields.name),
  description: Schema.optionalKey(LabelWriteRow.fields.description),
  imageUrl: Schema.optionalKey(LabelWriteRow.fields.imageUrl),
  bannerImageUrl: Schema.optionalKey(LabelWriteRow.fields.bannerImageUrl),
  content: Schema.optionalKey(LabelWriteRow.fields.content),
  tags: Schema.optionalKey(LabelWriteRow.fields.tags),
  genres: Schema.optionalKey(LabelWriteRow.fields.genres),
  slug: Schema.optionalKey(LabelWriteRow.fields.slug),
  publishedAt: Schema.optionalKey(LabelWriteRow.fields.publishedAt),
  createdById: Schema.optionalKey(LabelWriteRow.fields.createdById),
})

export const updateLabelEffect = (
  id: string,
  data: Partial<CreateLabelInput>,
  write?: MusicWriteRequest,
) =>
  Effect.gen(function* () {
    const patch = yield* Schema.encodeEffect(LabelWritePatch)(omitUndefined(data)).pipe(
      Effect.mapError(
        () => new MusicWriteError({ code: 'invalid_input', message: 'Invalid label edit.' }),
      ),
    )

    const saved = yield* writeMusicMetadata({
      target: { entityType: 'label', entityId: id },
      write,
      patch,
      row: LabelWriteRow,
      load: getLabelByIdEffect(id),
      validate: validateCanonicalContent(data.content).pipe(
        Effect.mapError(
          () =>
            new MusicWriteError({ code: 'invalid_input', message: 'Invalid canonical content.' }),
        ),
      ),
    })

    return { ...saved, tags: saved.tags?.slice() ?? null, genres: saved.genres?.slice() ?? null }
  }).pipe(Effect.withSpan('musicEntity.updateLabel', { attributes: { id } }))

export const deleteLabelEffect = (id: string, write?: MusicWriteRequest) =>
  deleteMusicEntity({ entityType: 'label', entityId: id }, write)

export type { SelectMusicLabel }
