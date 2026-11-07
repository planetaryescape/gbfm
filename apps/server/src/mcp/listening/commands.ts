import { and, eq, sql } from 'drizzle-orm'
import { Clock, Context, Effect, Layer, Match, Option, Schema } from 'effect'

import { Database } from '@/db/layer'
import {
  listeningCollectionsTable as collections,
  savedMixesTable as mixes,
} from '@/db/listening.schema'
import { parseListeningSource } from '@/services/listening-import'

import { CommandAuthority } from '../command-authority'
import { McpToolError } from '../contracts'
import {
  McpOperationStore,
  type AtomicOperationPlan,
  type JsonValue,
  type OperationContext,
  type OperationOutcome,
} from '../operations/store'
import {
  CollectionCommandResult,
  type CreateCollectionInput,
  SavedMixCommandResult,
  type SaveMixInput,
  type SetCollectionMembershipInput,
  type SetListeningStatusInput,
  type UpdateCollectionInput,
  type UpdateListeningNotesInput,
} from './contracts'

const maximumRevision = Number.MAX_SAFE_INTEGER

const Access = Schema.Struct({
  mixId: Schema.optionalKey(Schema.NonEmptyString),
  collectionId: Schema.optionalKey(Schema.NonEmptyString),
  privateOnly: Schema.Boolean,
}).check(
  Schema.makeFilter((value) => value.mixId !== undefined || value.collectionId !== undefined),
)

const failure = (code: typeof McpToolError.Type.code) =>
  new McpToolError({
    code,
    message: Match.value(code).pipe(
      Match.when('conflict', () => 'Listening state changed; read it again before editing.'),
      Match.when('access_denied', () => 'MCP access denied.'),
      Match.when('expired', () => 'This request has expired and cannot be applied again.'),
      Match.when('invalid_input', () => 'Invalid listening command.'),
      Match.orElse(() => 'Listening command unavailable.'),
    ),
  })

const makeCommands = Effect.gen(function* () {
  const db = yield* Database
  const operations = yield* McpOperationStore

  const authorize = Effect.gen(function* () {
    const authority = yield* Effect.serviceOption(CommandAuthority)

    if (Option.isNone(authority)) return yield* failure('access_denied')

    return yield* authority.value.checkpoint(['listening:read', 'listening:write'])
  })

  const execute = Effect.fn('ListeningMcp.execute')(function* (
    operation: string,
    requestId: string,
    normalizedInput: JsonValue,
    build: (context: OperationContext, actorId: string) => AtomicOperationPlan,
  ) {
    const actor = yield* authorize
    const now = yield* Clock.currentTimeMillis
    const runPromise = Effect.runPromiseWith(yield* Effect.context())

    const response = yield* Effect.tryPromise({
      try: () =>
        operations.execute({
          key: {
            actorId: actor.actorId,
            clientId: actor.clientId,
            resource: actor.resource,
            operation,
            requestId,
          },
          normalizedInput,
          now,
          authorize: (outcome?: OperationOutcome) =>
            runPromise(
              Effect.gen(function* () {
                const current = yield* authorize

                if (
                  current.actorId !== actor.actorId ||
                  current.clientId !== actor.clientId ||
                  current.resource !== actor.resource
                )
                  return false

                if (!outcome) return true
                const access = yield* Schema.decodeUnknownEffect(Access)(outcome.access)
                const { mixId, collectionId } = access

                if (mixId !== undefined) {
                  const [row] = yield* Effect.tryPromise({
                    try: () =>
                      db
                        .select({ published: mixes.published })
                        .from(mixes)
                        .where(
                          and(
                            eq(mixes.id, mixId),
                            eq(mixes.userId, actor.actorId),
                            current.liveGuard,
                          ),
                        )
                        .limit(1),
                    catch: () => failure('unavailable'),
                  })

                  if (!row || (access.privateOnly && row.published)) return false
                }

                if (collectionId !== undefined) {
                  const [row] = yield* Effect.tryPromise({
                    try: () =>
                      db
                        .select({ published: collections.published })
                        .from(collections)
                        .where(
                          and(
                            eq(collections.id, collectionId),
                            eq(collections.userId, actor.actorId),
                            current.liveGuard,
                          ),
                        )
                        .limit(1),
                    catch: () => failure('unavailable'),
                  })

                  if (!row || (access.privateOnly && row.published)) return false
                }

                return true
              }).pipe(
                Effect.catchTag('McpToolError', (error) =>
                  error.code === 'access_denied' ? Effect.succeed(false) : Effect.fail(error),
                ),
              ),
            ),
          build: (context) => {
            const fence = sql`(${context.fence}) AND (${actor.liveGuard})`
            const plan = build({ ...context, fence }, actor.actorId)

            return { ...plan, assertApplied: sql`(${plan.assertApplied}) AND (${fence})` }
          },
        }),
      catch: () => failure('unavailable'),
    })

    if (response.status === 'unavailable') {
      yield* Effect.logError('mcp.listening.unavailable', { operation, dependency: 'operations' })
    }

    if (response.status !== 'applied' && response.status !== 'replayed')
      return yield* failure(response.status)

    return response.outcome.result
  })

  const saveMix = Effect.fn('ListeningMcp.saveMix')(function* (input: typeof SaveMixInput.Type) {
    const actor = yield* authorize

    const source = yield* parseListeningSource(input.url).pipe(
      Effect.mapError(() => failure('invalid_input')),
    )

    const [existing] = yield* Effect.tryPromise({
      try: () =>
        db
          .select({ id: mixes.id, revision: mixes.revision })
          .from(mixes)
          .where(and(eq(mixes.userId, actor.actorId), eq(mixes.url, source.url), actor.liveGuard))
          .limit(1),
      catch: () => failure('unavailable'),
    })

    const mixId = existing?.id ?? crypto.randomUUID()
    const revision = existing?.revision ?? 1
    const now = yield* Clock.currentTimeMillis
    const result = { mixId, version: `revision:${revision}` }

    const value = yield* execute(
      'save_mix',
      input.requestId,
      { url: source.url, title: input.title.trim() },
      (ctx, actorId) => ({
        statements: [
          ctx.prepare(sql`insert into saved_mixes (id,user_id,url,platform,embed_url,title,notes,status,published,created_at,revision,last_operation_id)
          select ${mixId},${actorId},${source.url},${source.platform},${source.embedUrl},${input.title.trim()},'','to-listen',0,${now},1,${ctx.attemptId}
          where ${ctx.fence}
          on conflict(user_id,url) do update set last_operation_id=${ctx.attemptId}
          where saved_mixes.id=${mixId} and saved_mixes.user_id=${actorId} and saved_mixes.revision=${revision}
          and ${ctx.fence}`),
        ],
        assertApplied: sql`exists(select 1 from saved_mixes where id=${mixId} and user_id=${actorId} and last_operation_id=${ctx.attemptId})`,
        outcome: { result, revision: result.version, access: { mixId, privateOnly: false } },
      }),
    )

    return yield* Schema.decodeUnknownEffect(SavedMixCommandResult)(value).pipe(
      Effect.mapError(() => failure('unavailable')),
    )
  })

  const updateMix = Effect.fn('ListeningMcp.updateMix')(function* (
    operation: 'update_listening_notes' | 'set_listening_status',
    input: typeof UpdateListeningNotesInput.Type | typeof SetListeningStatusInput.Type,
  ) {
    const revision = Number(input.expectedVersion.slice('revision:'.length))
    const result = { mixId: input.mixId, version: `revision:${revision + 1}` }
    const patch = 'notes' in input ? sql`notes=${input.notes}` : sql`status=${input.status}`

    const normalizedInput: JsonValue =
      'notes' in input
        ? { mixId: input.mixId, expectedVersion: input.expectedVersion, notes: input.notes }
        : { mixId: input.mixId, expectedVersion: input.expectedVersion, status: input.status }

    const value = yield* execute(operation, input.requestId, normalizedInput, (ctx, actorId) => ({
      statements: [
        ctx.prepare(sql`update saved_mixes set ${patch},revision=revision+1,last_operation_id=${ctx.attemptId}
        where id=${input.mixId} and user_id=${actorId} and published=0 and revision=${revision} and revision<${maximumRevision}
        and ${ctx.fence}`),
      ],
      assertApplied: sql`exists(select 1 from saved_mixes where id=${input.mixId} and user_id=${actorId} and last_operation_id=${ctx.attemptId})`,
      outcome: {
        result,
        revision: result.version,
        access: { mixId: input.mixId, privateOnly: true },
      },
    }))

    return yield* Schema.decodeUnknownEffect(SavedMixCommandResult)(value).pipe(
      Effect.mapError(() => failure('unavailable')),
    )
  })

  const createCollection = Effect.fn('ListeningMcp.createCollection')(function* (
    input: typeof CreateCollectionInput.Type,
  ) {
    const collectionId = crypto.randomUUID()
    const result = { collectionId, version: 'revision:1' }
    const now = yield* Clock.currentTimeMillis
    const normalizedInput = { title: input.title.trim(), description: input.description ?? '' }

    const value = yield* execute(
      'create_collection',
      input.requestId,
      normalizedInput,
      (ctx, actorId) => ({
        statements: [
          ctx.prepare(sql`insert into listening_collections (id,user_id,title,description,published,created_at,revision,last_operation_id)
        select ${collectionId},${actorId},${input.title.trim()},${input.description ?? ''},0,${now},1,${ctx.attemptId}
        where ${ctx.fence}`),
        ],
        assertApplied: sql`exists(select 1 from listening_collections where id=${collectionId} and user_id=${actorId} and last_operation_id=${ctx.attemptId})`,
        outcome: { result, revision: result.version, access: { collectionId, privateOnly: true } },
      }),
    )

    return yield* Schema.decodeUnknownEffect(CollectionCommandResult)(value).pipe(
      Effect.mapError(() => failure('unavailable')),
    )
  })

  const updateCollection = Effect.fn('ListeningMcp.updateCollection')(function* (
    input: typeof UpdateCollectionInput.Type,
  ) {
    const revision = Number(input.expectedVersion.slice('revision:'.length))
    const result = { collectionId: input.collectionId, version: `revision:${revision + 1}` }

    const fields = [
      ...(input.title === undefined ? [] : [sql`title=${input.title.trim()}`]),
      ...(input.description === undefined ? [] : [sql`description=${input.description}`]),
      sql`revision=revision+1`,
    ]

    const normalizedInput = {
      collectionId: input.collectionId,
      expectedVersion: input.expectedVersion,
      title: input.title?.trim() ?? null,
      description: input.description ?? null,
    }

    const value = yield* execute(
      'update_collection',
      input.requestId,
      normalizedInput,
      (ctx, actorId) => ({
        statements: [
          ctx.prepare(sql`update listening_collections set ${sql.join(fields, sql`, `)},last_operation_id=${ctx.attemptId}
        where id=${input.collectionId} and user_id=${actorId} and published=0 and revision=${revision} and revision<${maximumRevision}
        and ${ctx.fence}`),
        ],
        assertApplied: sql`exists(select 1 from listening_collections where id=${input.collectionId} and user_id=${actorId} and last_operation_id=${ctx.attemptId})`,
        outcome: {
          result,
          revision: result.version,
          access: { collectionId: input.collectionId, privateOnly: true },
        },
      }),
    )

    return yield* Schema.decodeUnknownEffect(CollectionCommandResult)(value).pipe(
      Effect.mapError(() => failure('unavailable')),
    )
  })

  const setCollectionMembership = Effect.fn('ListeningMcp.setCollectionMembership')(function* (
    input: typeof SetCollectionMembershipInput.Type,
  ) {
    const revision = Number(input.expectedVersion.slice('revision:'.length))
    const result = { collectionId: input.collectionId, version: `revision:${revision + 1}` }

    const value = yield* execute(
      'set_collection_membership',
      input.requestId,
      {
        collectionId: input.collectionId,
        mixId: input.mixId,
        expectedVersion: input.expectedVersion,
        included: input.included,
      },
      (ctx, actorId) => {
        const ownedMix = sql`exists(select 1 from saved_mixes where id=${input.mixId} and user_id=${actorId} and published=0)`
        const winner = sql`exists(select 1 from listening_collections where id=${input.collectionId} and user_id=${actorId} and published=0 and last_operation_id=${ctx.attemptId})`

        return {
          statements: [
            ctx.prepare(sql`update listening_collections set revision=revision+1,last_operation_id=${ctx.attemptId}
            where id=${input.collectionId} and user_id=${actorId} and published=0 and revision=${revision} and revision<${maximumRevision}
            and ${ownedMix} and ${ctx.fence}`),
            ctx.prepare(
              input.included
                ? sql`insert into listening_memberships(collection_id,mix_id) select ${input.collectionId},${input.mixId}
                where ${ctx.fence} and ${winner} and ${ownedMix} on conflict do nothing`
                : sql`delete from listening_memberships where collection_id=${input.collectionId} and mix_id=${input.mixId}
                and ${ctx.fence} and ${winner} and ${ownedMix}`,
            ),
          ],
          assertApplied: winner,
          outcome: {
            result,
            revision: result.version,
            access: { collectionId: input.collectionId, mixId: input.mixId, privateOnly: true },
          },
        }
      },
    )

    return yield* Schema.decodeUnknownEffect(CollectionCommandResult)(value).pipe(
      Effect.mapError(() => failure('unavailable')),
    )
  })

  return {
    saveMix,
    createCollection,
    updateCollection,
    setCollectionMembership,
    updateListeningNotes: (input: typeof UpdateListeningNotesInput.Type) =>
      updateMix('update_listening_notes', input),
    setListeningStatus: (input: typeof SetListeningStatusInput.Type) =>
      updateMix('set_listening_status', input),
  }
})

/** Private commands require request-scoped authority and the common atomic receipt store. */
export class ListeningCommandService extends Context.Service<
  ListeningCommandService,
  Effect.Success<typeof makeCommands>
>()('gbfm/mcp/ListeningCommandService') {}

export const ListeningCommandServiceLive = Layer.effect(ListeningCommandService, makeCommands)
