import { desc, eq } from 'drizzle-orm'
import { Context, Effect, Layer, Schema } from 'effect'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import {
  listeningCollectionsTable as collections,
  savedMixesTable as mixes,
} from '@/db/listening.schema'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { McpToolError } from '../contracts'
import { CollectionPage, type ListeningPageInput, SavedMixPage } from './contracts'

const unavailable = () =>
  new McpToolError({ code: 'unavailable', message: 'Listening library unavailable.' })

/** Bounded private projections; identity comes exclusively from current MCP authorization. */
export class ListeningReadService extends Context.Service<
  ListeningReadService,
  {
    readonly listSavedMixes: (
      input: typeof ListeningPageInput.Type,
    ) => Effect.Effect<typeof SavedMixPage.Type, McpToolError>
    readonly listCollections: (
      input: typeof ListeningPageInput.Type,
    ) => Effect.Effect<typeof CollectionPage.Type, McpToolError>
  }
>()('gbfm/mcp/ListeningReadService') {}

/** SQL filters owners before pagination; no unbounded library snapshot or cross-owner counts. */
export const ListeningReadServiceLive = Layer.effect(
  ListeningReadService,
  Effect.gen(function* () {
    const db = yield* Database
    const authorization = yield* McpAuthorization

    const authorize = authorization
      .listener(['listening:read'])
      .pipe(
        Effect.mapError((error) => new McpToolError({ code: error.code, message: error.message })),
      )

    const listSavedMixes = Effect.fn('ListeningMcp.listSavedMixes')(function* (
      input: typeof ListeningPageInput.Type,
    ) {
      const actor = yield* authorize
      const limit = input.limit ?? 20
      const offset = input.offset ?? 0

      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select()
            .from(mixes)
            .where(eq(mixes.userId, actor.userId))
            .orderBy(desc(mixes.createdAt), desc(mixes.id))
            .limit(limit + 1)
            .offset(offset),
        catch: unavailable,
      }).pipe(
        Effect.tapError(() =>
          Effect.logError('mcp.listening.unavailable', {
            operation: 'saved_mixes.list',
            dependency: 'database',
          }),
        ),
      )

      return yield* Schema.decodeUnknownEffect(SavedMixPage)({
        mixes: rows.slice(0, limit).map((row) => ({ ...row, version: `revision:${row.revision}` })),
        pagination: { limit, offset, hasMore: rows.length > limit },
      }).pipe(
        Effect.tapError(() =>
          Effect.logError('mcp.listening.projection_invalid', {
            operation: 'saved_mixes.list',
            dependency: 'projection',
          }),
        ),
        Effect.mapError(unavailable),
      )
    })

    const listCollections = Effect.fn('ListeningMcp.listCollections')(function* (
      input: typeof ListeningPageInput.Type,
    ) {
      const actor = yield* authorize
      const limit = input.limit ?? 20
      const offset = input.offset ?? 0

      const rows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({
              id: collections.id,
              title: collections.title,
              description: collections.description,
              published: collections.published,
              ownerName: user.name,
              revision: collections.revision,
            })
            .from(collections)
            .innerJoin(user, eq(user.id, collections.userId))
            .where(eq(collections.userId, actor.userId))
            .orderBy(desc(collections.createdAt), desc(collections.id))
            .limit(limit + 1)
            .offset(offset),
        catch: unavailable,
      }).pipe(
        Effect.tapError(() =>
          Effect.logError('mcp.listening.unavailable', {
            operation: 'collections.list',
            dependency: 'database',
          }),
        ),
      )

      return yield* Schema.decodeUnknownEffect(CollectionPage)({
        collections: rows
          .slice(0, limit)
          .map((row) => ({ ...row, version: `revision:${row.revision}` })),
        pagination: { limit, offset, hasMore: rows.length > limit },
      }).pipe(
        Effect.tapError(() =>
          Effect.logError('mcp.listening.projection_invalid', {
            operation: 'collections.list',
            dependency: 'projection',
          }),
        ),
        Effect.mapError(unavailable),
      )
    })

    return { listSavedMixes, listCollections }
  }),
).pipe(Layer.provide(McpAuthorizationLive))
