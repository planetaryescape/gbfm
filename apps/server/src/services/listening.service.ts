import {
  type EditCollectionInput,
  type EditMixInput,
  ListeningDocument,
  type SaveMixesInput,
} from '@gbfm/api/listening'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import {
  listeningCollectionsTable as collections,
  listeningMembershipsTable as memberships,
  savedMixesTable as mixes,
} from '@/db/listening.schema'
import { createPaginationMetadata } from '@/lib/pagination'

import { parseListeningSource } from './listening-import'

/** Expected workspace failures; persistence details never reach clients. */
export class ListeningError extends Schema.TaggedError<ListeningError>()('ListeningError', {
  reason: Schema.Literals(['invalid', 'not-found', 'unavailable']),
}) {}

const query = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: () => Promise.resolve(run()),
    catch: () => new ListeningError({ reason: 'unavailable' }),
  })

const notFound = () => new ListeningError({ reason: 'not-found' })

/** Reads only the authenticated listener's saves and memberships. */
export const listeningLibrary = Effect.fn('Listening.library')(function* (userId: string) {
  const db = yield* Database

  const saved = yield* query(() =>
    db.select().from(mixes).where(eq(mixes.userId, userId)).orderBy(desc(mixes.createdAt)),
  )

  const owned = yield* query(() =>
    db
      .select({
        id: collections.id,
        title: collections.title,
        description: collections.description,
        published: collections.published,
        ownerName: user.name,
      })
      .from(collections)
      .innerJoin(user, eq(user.id, collections.userId))
      .where(eq(collections.userId, userId))
      .orderBy(desc(collections.createdAt)),
  )

  const links = yield* query(() =>
    db
      .select({ collectionId: memberships.collectionId, mixId: memberships.mixId })
      .from(memberships)
      .innerJoin(collections, eq(collections.id, memberships.collectionId))
      .innerJoin(mixes, eq(mixes.id, memberships.mixId))
      .where(and(eq(collections.userId, userId), eq(mixes.userId, userId))),
  )

  return yield* Schema.decodeUnknownEffect(ListeningDocument)({
    mixes: saved,
    collections: owned,
    memberships: links,
  }).pipe(Effect.mapError(() => new ListeningError({ reason: 'unavailable' })))
})

/** Public reads filter both collection and mix visibility in SQL, even for owners. */
export const publicListeningCollections = Effect.fn('Listening.public')(function* (id?: string) {
  const db = yield* Database

  const visible = yield* query(() =>
    db
      .select({
        id: collections.id,
        title: collections.title,
        description: collections.description,
        published: collections.published,
        ownerName: user.name,
      })
      .from(collections)
      .innerJoin(user, eq(user.id, collections.userId))
      .where(and(eq(collections.published, true), id ? eq(collections.id, id) : undefined))
      .orderBy(desc(collections.createdAt)),
  )

  if (id && visible.length === 0) return yield* notFound()

  const entries = id
    ? yield* query(() =>
        db
          .select({ mix: mixes })
          .from(memberships)
          .innerJoin(mixes, eq(mixes.id, memberships.mixId))
          .innerJoin(collections, eq(collections.id, memberships.collectionId))
          .where(
            and(
              eq(collections.id, id),
              eq(collections.published, true),
              eq(mixes.published, true),
              eq(mixes.userId, collections.userId),
            ),
          )
          .orderBy(desc(mixes.createdAt)),
      )
    : []

  return yield* Schema.decodeUnknownEffect(ListeningDocument)({
    collections: visible,
    mixes: entries.map(({ mix }) => mix),
    memberships: [],
  }).pipe(Effect.mapError(() => new ListeningError({ reason: 'unavailable' })))
})

/** Published listening collection/member page, using the existing anonymous ownership predicates. */
export const publicListeningCollectionPage = Effect.fn('Listening.publicPage')(function* (
  id: string,
  { limit, offset }: { limit: number; offset: number },
) {
  const db = yield* Database

  const visible = yield* query(() =>
    db
      .select({
        id: collections.id,
        title: collections.title,
        description: collections.description,
        ownerName: user.name,
      })
      .from(collections)
      .innerJoin(user, eq(user.id, collections.userId))
      .where(and(eq(collections.id, id), eq(collections.published, true)))
      .limit(1),
  )

  if (!visible[0]) return yield* notFound()

  const where = and(
    eq(collections.id, id),
    eq(collections.published, true),
    eq(mixes.published, true),
    eq(mixes.userId, collections.userId),
  )

  const totals = yield* query(() =>
    db
      .select({ total: count() })
      .from(memberships)
      .innerJoin(mixes, eq(mixes.id, memberships.mixId))
      .innerJoin(collections, eq(collections.id, memberships.collectionId))
      .where(where),
  )

  const entries = yield* query(() =>
    db
      .select({
        id: mixes.id,
        title: mixes.title,
        url: mixes.url,
        platform: mixes.platform,
        notes: mixes.notes,
        status: mixes.status,
      })
      .from(memberships)
      .innerJoin(mixes, eq(mixes.id, memberships.mixId))
      .innerJoin(collections, eq(collections.id, memberships.collectionId))
      .where(where)
      .orderBy(desc(mixes.createdAt), desc(mixes.id))
      .limit(limit)
      .offset(offset),
  )

  return {
    collection: visible[0],
    mixes: entries,
    pagination: createPaginationMetadata(totals[0]?.total ?? 0, limit, offset),
  }
})

/** Atomic, idempotent bulk save: importing again preserves existing notes and state. */
export const saveListeningMixes = Effect.fn('Listening.save')(function* (
  userId: string,
  input: typeof SaveMixesInput.Type,
) {
  const db = yield* Database

  const sources = yield* Effect.forEach(input.items, (item) =>
    Effect.gen(function* () {
      const source = yield* parseListeningSource(item.url).pipe(
        Effect.mapError(() => new ListeningError({ reason: 'invalid' })),
      )

      if (!item.title.trim()) return yield* new ListeningError({ reason: 'invalid' })

      return { ...source, title: item.title.trim(), userId }
    }),
  )

  // D1 has a bound-parameter limit: each small insert is one statement in an atomic batch.
  const statements = sources.map((source) =>
    db
      .insert(mixes)
      .values(source)
      .onConflictDoNothing({ target: [mixes.userId, mixes.url] }),
  )

  const [first, ...rest] = statements

  if (first) yield* query(() => db.batch([first, ...rest]))
})

/** Owner-scoped edit; unpublished notes never become public via collection membership. */
export const editListeningMix = Effect.fn('Listening.editMix')(function* (
  userId: string,
  id: string,
  input: typeof EditMixInput.Type,
) {
  if (!input.title.trim()) yield* new ListeningError({ reason: 'invalid' })
  const db = yield* Database

  const rows = yield* query(() =>
    db
      .update(mixes)
      .set({ ...input, title: input.title.trim() })
      .where(and(eq(mixes.userId, userId), eq(mixes.id, id)))
      .returning({ id: mixes.id }),
  )

  if (!rows.length) yield* notFound()
})

/** Creates or edits an owner's named collection. */
export const writeListeningCollection = Effect.fn('Listening.writeCollection')(function* (
  userId: string,
  input: typeof EditCollectionInput.Type,
  id?: string,
) {
  if (!input.title.trim()) yield* new ListeningError({ reason: 'invalid' })
  const db = yield* Database
  const values = { ...input, title: input.title.trim() }

  if (!id) {
    yield* query(() => db.insert(collections).values({ ...values, userId }))

    return
  }

  const rows = yield* query(() =>
    db
      .update(collections)
      .set(values)
      .where(and(eq(collections.userId, userId), eq(collections.id, id)))
      .returning({ id: collections.id }),
  )

  if (!rows.length) yield* notFound()
})

/** Membership writes require ownership of both sides, checked in the write itself. */
export const setListeningMembership = Effect.fn('Listening.membership')(function* (
  userId: string,
  collectionId: string,
  mixId: string,
  included: boolean,
) {
  const db = yield* Database

  const ownedCollection = db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)))

  const ownedMix = db
    .select({ id: mixes.id })
    .from(mixes)
    .where(and(eq(mixes.id, mixId), eq(mixes.userId, userId)))

  if (included) {
    const rows = yield* query(() =>
      db
        .select({ collectionId: collections.id, mixId: mixes.id })
        .from(collections)
        .innerJoin(mixes, eq(mixes.userId, collections.userId))
        .where(
          and(
            eq(collections.id, collectionId),
            eq(mixes.id, mixId),
            eq(collections.userId, userId),
          ),
        ),
    )

    if (!rows.length) yield* notFound()
    yield* query(() =>
      db
        .insert(memberships)
        .select(
          db
            .select({ collectionId: collections.id, mixId: mixes.id })
            .from(collections)
            .innerJoin(mixes, eq(mixes.userId, collections.userId))
            .where(
              and(
                eq(collections.id, collectionId),
                eq(mixes.id, mixId),
                eq(collections.userId, userId),
              ),
            ),
        )
        .onConflictDoNothing(),
    )
  } else {
    yield* query(() =>
      db
        .delete(memberships)
        .where(
          and(
            inArray(memberships.collectionId, ownedCollection),
            inArray(memberships.mixId, ownedMix),
          ),
        ),
    )
  }
})

/** Removes a save or collection only when owned; dependent memberships cascade. */
export const deleteListeningItem = Effect.fn('Listening.delete')(function* (
  userId: string,
  id: string,
  kind: 'mix' | 'collection',
) {
  const db = yield* Database
  const table = kind === 'mix' ? mixes : collections

  const rows = yield* query(() =>
    db
      .delete(table)
      .where(and(eq(table.id, id), eq(table.userId, userId)))
      .returning({ id: table.id }),
  )

  if (!rows.length) yield* notFound()
})
