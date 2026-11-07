import type { McpScope } from '@gbfm/core/editorial-mcp'
import { type SQL, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import {
  executeMusicWrite,
  MusicWriteError,
  MusicWriteStoredOutcome,
  MusicWriteStoreResult,
} from '@/services/music-entity/write-intent'

import { McpToolError } from '../contracts'
import { McpOperationStore } from '../operations/store'
import { MusicEditCommand } from './commands'
import { musicEditTarget, planMusicEdit } from './planner'
import { musicEditStatements } from './statements'

/** Composition supplies the persisted request authority, never a fallback. */
export const createMusicEditExecutor = (
  checkpoint: (requiredScopes: ReadonlyArray<McpScope>) => Effect.Effect<
    {
      readonly actorId: string
      readonly clientId: string
      readonly resource: string
      readonly liveGuard: SQL
    },
    McpToolError
  >,
) => ({
  apply: Effect.fn('MusicEdit.apply')(function* (raw: Schema.Json, now: number) {
    const store = yield* McpOperationStore
    yield* checkpoint(['catalogue:write'])

    const command = yield* Schema.decodeUnknownEffect(MusicEditCommand)(raw, {
      onExcessProperty: 'error',
    }).pipe(
      Effect.mapError(
        () => new McpToolError({ code: 'invalid_input', message: 'Invalid music edit.' }),
      ),
    )

    const target = musicEditTarget(command.change)

    return yield* executeMusicWrite(
      { requestId: command.requestId, expectedRevision: command.expectedRevision },
      {
        now,
        execute: async (input) =>
          Schema.decodeUnknownSync(MusicWriteStoreResult)(
            await store.execute({
              ...input,
              authorize: (outcome) =>
                input.authorize(
                  outcome === undefined
                    ? undefined
                    : Schema.decodeUnknownSync(MusicWriteStoredOutcome)(outcome),
                ),
            }),
          ),
        checkpoint: checkpoint(['catalogue:write']).pipe(
          Effect.mapError(
            (error) =>
              new MusicWriteError({
                code: error.code === 'access_denied' ? 'access_denied' : 'unavailable',
                message: 'Music write authorization failed.',
              }),
          ),
        ),
      },
      {
        operation: command.change.operation,
        target,
        normalizedInput: command,
        prepare: planMusicEdit(command.change).pipe(
          Effect.mapError(
            (error) =>
              new MusicWriteError({
                code: error.code === 'not_found' ? 'not_found' : 'unavailable',
                message: 'Music write preparation failed.',
              }),
          ),
          Effect.map((plan) => ({
            build: (ctx) => ({
              ...musicEditStatements({
                command,
                changed: plan.changed,
                artistNameChanged:
                  command.change.operation === 'update_music_metadata' &&
                  command.change.entityType === 'artist' &&
                  command.change.metadata.name !== undefined &&
                  Schema.is(Schema.JsonObject)(plan.before) &&
                  plan.before.name !== command.change.metadata.name,
                now,
                attemptId: ctx.attemptId,
                fence: ctx.fence,
                prepare: ctx.prepare,
                liveGuard: ctx.liveGuard,
                eligibility: sql`${plan.revision === command.expectedRevision ? 1 : 0}`,
              }),
              outcome: {
                result: {
                  operation: command.change.operation,
                  ...target,
                  field: plan.field,
                  after: plan.after,
                  changed: plan.changed,
                },
                revision: {
                  ...target,
                  revision: command.expectedRevision + (plan.changed ? 1 : 0),
                },
                access: target,
              },
            }),
          })),
        ),
      },
    ).pipe(
      Effect.catchTag('MusicWriteError', (error) => {
        if (error.code === 'not_found' || error.code === 'precondition_required')
          return Effect.fail(new McpToolError({ code: error.code, message: error.message }))

        return Effect.succeed({ status: error.code })
      }),
    )
  }),
})
