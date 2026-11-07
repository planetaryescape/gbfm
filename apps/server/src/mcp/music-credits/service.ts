import { sql } from 'drizzle-orm'
import { Context, Effect, Layer, Result, Schema, type Types } from 'effect'

import { Database } from '../../db/layer'
import type {
  musicArtistAliasesTable,
  musicRecordingCreditsTable,
} from '../../db/music-credit.schema'
import { McpAuthorization } from '../authorization'
import { CommandAuthority, type CommandCheckpoint } from '../command-authority'
import { EndpointIdentity, McpToolError } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { musicParentCas, musicParentWinner } from '../music-edit/statements'
import { musicVersion } from '../music-edit/version'
import {
  McpOperationStore,
  type OperationContext,
  type OperationPreparation,
  type OperationOutcome,
} from '../operations/store'
import { parseArtistAliases, parseRecordingCredits } from './contract'
import {
  AdminAlias,
  AdminCredit,
  AliasesReadInput,
  CreditsReadInput,
  FactsTarget,
  type MusicFactsWire,
  PublicAlias,
  PublicCredit,
  SavedFacts,
  musicFactsWriteFits,
  projectFactsPage,
} from './projection'
import { prepareAliasReplacement, prepareCreditReplacement } from './replacement'
import { artistAliasStatements, recordingCreditStatements } from './statements'
import {
  factsTargetExists,
  factsUnavailable,
  loadAliasSnapshot,
  loadCreditSnapshot,
} from './storage'

const invalid = () =>
  new McpToolError({
    code: 'invalid_input',
    message: 'Invalid or oversized music facts collection.',
  })

const conflict = () =>
  new McpToolError({
    code: 'conflict',
    message: 'Music facts changed; read a fresh complete editable collection.',
  })

const sameAuthority = (a: CommandCheckpoint, b: CommandCheckpoint) =>
  a.actorId === b.actorId && a.clientId === b.clientId && a.resource === b.resource

const creditProjection = (
  row: typeof musicRecordingCreditsTable.$inferSelect,
  editable: boolean,
) => {
  const publicFields: Types.Mutable<typeof PublicCredit.Type> = {
    id: row.id,
    creditedName: row.creditedName,
    role: row.role,
    displayOrder: row.displayOrder,
    sourceLabel: row.sourceLabel,
  }

  if (row.artistId !== null) publicFields.artistId = row.artistId

  if (row.instrument !== null) publicFields.instrument = row.instrument

  if (row.sourceUrl !== null) publicFields.sourceUrl = row.sourceUrl

  if (row.evidenceNote !== null) publicFields.evidenceNote = row.evidenceNote

  return editable
    ? Schema.decodeUnknownEffect(AdminCredit)({
        ...publicFields,
        assertedById: row.assertedById,
        assertedAt: row.assertedAt.getTime(),
        createdAt: row.createdAt.getTime(),
      }).pipe(Effect.mapError(factsUnavailable))
    : Schema.decodeUnknownEffect(PublicCredit)(publicFields).pipe(Effect.mapError(factsUnavailable))
}

const aliasProjection = (row: typeof musicArtistAliasesTable.$inferSelect, editable: boolean) => {
  const publicFields: Types.Mutable<typeof PublicAlias.Type> = {
    id: row.id,
    name: row.name,
    sourceLabel: row.sourceLabel,
  }

  if (row.sourceUrl !== null) publicFields.sourceUrl = row.sourceUrl

  if (row.evidenceNote !== null) publicFields.evidenceNote = row.evidenceNote

  return editable
    ? Schema.decodeUnknownEffect(AdminAlias)({
        ...publicFields,
        assertedById: row.assertedById,
        assertedAt: row.assertedAt.getTime(),
        createdAt: row.createdAt.getTime(),
      }).pipe(Effect.mapError(factsUnavailable))
    : Schema.decodeUnknownEffect(PublicAlias)(publicFields).pipe(Effect.mapError(factsUnavailable))
}

// SQLite BINARY compares UTF-8 bytes, not JS UTF-16 or locale collation.
const binaryCompare = (a: string, b: string) => {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)

  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const l = left.at(i) ?? 0
    const r = right.at(i) ?? 0

    if (l !== r) return l - r
  }

  return left.length - right.length
}

const makeService = Effect.gen(function* () {
  const db = yield* Database
  const store = yield* McpOperationStore
  const config = yield* EditorialMcpConfig

  const endpoint = yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
    Effect.mapError(factsUnavailable),
  )

  const readRecordingCredits = Effect.fn('MusicFacts.readCredits')(function* (
    raw: Schema.Json,
    wire: MusicFactsWire,
  ) {
    const input = yield* Schema.decodeUnknownEffect(CreditsReadInput)(raw, {
      onExcessProperty: 'error',
    }).pipe(Effect.mapError(invalid))

    if (input.editable) yield* (yield* CommandAuthority).checkpoint(['catalogue:write'])
    else yield* (yield* McpAuthorization).catalogue
    const target = { entityType: input.target.type, entityId: input.target.id }
    const observed = yield* loadCreditSnapshot(db, target)

    const items = yield* Effect.forEach(observed.rows, (row) =>
      creditProjection(row, input.editable ?? false),
    )

    const page = projectFactsPage(
      endpoint,
      target,
      'recording_credits',
      items,
      yield* musicVersion({ ...target, revision: observed.revision }),
      input,
      wire,
    )

    if (wire.successBytes(page) > 256 * 1024) return yield* invalid()

    return page
  })

  const readArtistAliases = Effect.fn('MusicFacts.readAliases')(function* (
    raw: Schema.Json,
    wire: MusicFactsWire,
  ) {
    const input = yield* Schema.decodeUnknownEffect(AliasesReadInput)(raw, {
      onExcessProperty: 'error',
    }).pipe(Effect.mapError(invalid))

    if (input.editable) yield* (yield* CommandAuthority).checkpoint(['catalogue:write'])
    else yield* (yield* McpAuthorization).catalogue
    const target = { entityType: 'artist' as const, entityId: input.artistId }
    const observed = yield* loadAliasSnapshot(db, input.artistId)

    const items = yield* Effect.forEach(observed.rows, (row) =>
      aliasProjection(row, input.editable ?? false),
    )

    const page = projectFactsPage(
      endpoint,
      target,
      'artist_aliases',
      items,
      yield* musicVersion({ ...target, revision: observed.revision }),
      input,
      wire,
    )

    if (wire.successBytes(page) > 256 * 1024) return yield* invalid()

    return page
  })

  const apply = Effect.fn('MusicFacts.apply')(function* (
    command:
      | {
          readonly operation: 'set_recording_credits'
          readonly input: Effect.Success<ReturnType<typeof parseRecordingCredits>>
        }
      | {
          readonly operation: 'set_artist_aliases'
          readonly input: Effect.Success<ReturnType<typeof parseArtistAliases>>
        },
    now: number,
    wire: MusicFactsWire,
  ) {
    const authority = yield* CommandAuthority
    const initial = yield* authority.checkpoint(['catalogue:write'])

    const target =
      command.operation === 'set_recording_credits'
        ? { entityType: command.input.target.type, entityId: command.input.target.id }
        : { entityType: 'artist' as const, entityId: command.input.artistId }

    const runPromise = Effect.runPromiseWith(yield* Effect.context())

    const prepare: Effect.Effect<OperationPreparation, McpToolError> = Effect.gen(function* () {
      const fresh = yield* authority.checkpoint(['catalogue:write'])

      if (!sameAuthority(initial, fresh))
        return yield* new McpToolError({
          code: 'access_denied',
          message: 'Music authority changed.',
        })

      const assertion = {
        actorId: fresh.actorId,
        now: new Date(now),
        newId: () => crypto.randomUUID(),
      }

      if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + 86_400_000))
        return yield* invalid()

      if (command.operation === 'set_recording_credits') {
        const creditTarget = {
          entityType: command.input.target.type,
          entityId: command.input.target.id,
        }

        const observed = yield* loadCreditSnapshot(db, creditTarget)

        if (observed.rows.length > 50) return yield* invalid()

        if (
          (yield* musicVersion({ ...creditTarget, revision: observed.revision })) !==
          command.input.expectedVersion
        )
          return yield* conflict()
        const replacement = yield* prepareCreditReplacement(command.input, observed.rows, assertion)

        const ids = [
          ...new Set(
            replacement.rows.flatMap((row) => (row.artistId === null ? [] : [row.artistId])),
          ),
        ]

        const references = sql`(SELECT count(*) FROM music_artists WHERE id IN (SELECT value FROM json_each(${JSON.stringify(ids)})))=${ids.length}`

        const valid = yield* Effect.tryPromise({
          try: () => db.get(sql`SELECT CASE WHEN (${references}) THEN 1 ELSE 0 END AS valid`),
          catch: factsUnavailable,
        })

        const decoded = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ valid: Schema.Literals([0, 1]) }),
        )(valid).pipe(Effect.mapError(factsUnavailable))

        if (!decoded.valid) return yield* invalid()
        const revision = observed.revision + (replacement.changed ? 1 : 0)

        if (!Number.isSafeInteger(revision)) return yield* conflict()
        const version = yield* musicVersion({ ...creditTarget, revision })
        const items = yield* Effect.forEach(replacement.rows, (row) => creditProjection(row, true))

        const collection = projectFactsPage(
          endpoint,
          creditTarget,
          'recording_credits',
          items,
          version,
          { limit: 50, editable: true },
          wire,
        )

        const saved = yield* Schema.decodeUnknownEffect(SavedFacts)({
          collection,
          changed: replacement.changed,
        }).pipe(Effect.mapError(invalid))

        const outcome: OperationOutcome = {
          result: saved,
          revision: { ...creditTarget, revision },
          access: creditTarget,
        }

        if (!musicFactsWriteFits(outcome, saved, now, wire)) return yield* invalid()

        return {
          status: 'ready' as const,
          build: (ctx: OperationContext) => {
            const winner = sql`(${fresh.liveGuard}) AND (${ctx.fence}) AND (${musicParentWinner(creditTarget, ctx.attemptId)})`

            return {
              statements: [
                ctx.prepare(
                  musicParentCas({
                    target: creditTarget,
                    expectedRevision: observed.revision,
                    changed: replacement.changed,
                    attemptId: ctx.attemptId,
                    fence: ctx.fence,
                    liveGuard: fresh.liveGuard,
                    eligibility: references,
                    assignments: [],
                  }),
                ),
                ...(replacement.changed
                  ? recordingCreditStatements(ctx, winner, command.input.target, replacement.rows)
                  : []),
              ],
              assertApplied: winner,
              outcome,
            }
          },
        }
      }

      const aliasTarget = { entityType: 'artist' as const, entityId: command.input.artistId }
      const observed = yield* loadAliasSnapshot(db, command.input.artistId)

      if (observed.rows.length > 50) return yield* invalid()

      if (
        (yield* musicVersion({ ...aliasTarget, revision: observed.revision })) !==
        command.input.expectedVersion
      )
        return yield* conflict()

      const replacement = yield* prepareAliasReplacement(
        command.input,
        observed.name,
        observed.rows,
        assertion,
      )

      const revision = observed.revision + (replacement.changed ? 1 : 0)

      if (!Number.isSafeInteger(revision)) return yield* conflict()
      const version = yield* musicVersion({ ...aliasTarget, revision })

      const rows = replacement.rows.toSorted(
        (a, b) => binaryCompare(a.nameKey, b.nameKey) || binaryCompare(a.id, b.id),
      )

      const items = yield* Effect.forEach(rows, (row) => aliasProjection(row, true))

      const collection = projectFactsPage(
        endpoint,
        aliasTarget,
        'artist_aliases',
        items,
        version,
        { limit: 50, editable: true },
        wire,
      )

      const saved = yield* Schema.decodeUnknownEffect(SavedFacts)({
        collection,
        changed: replacement.changed,
      }).pipe(Effect.mapError(invalid))

      const outcome: OperationOutcome = {
        result: saved,
        revision: { ...aliasTarget, revision },
        access: aliasTarget,
      }

      if (!musicFactsWriteFits(outcome, saved, now, wire)) return yield* invalid()

      return {
        status: 'ready' as const,
        build: (ctx: OperationContext) => {
          const winner = sql`(${fresh.liveGuard}) AND (${ctx.fence}) AND (${musicParentWinner(aliasTarget, ctx.attemptId)})`

          return {
            statements: [
              ctx.prepare(
                musicParentCas({
                  target: aliasTarget,
                  expectedRevision: observed.revision,
                  changed: replacement.changed,
                  attemptId: ctx.attemptId,
                  fence: ctx.fence,
                  liveGuard: fresh.liveGuard,
                  eligibility: sql`name=${observed.name}`,
                  assignments: [],
                }),
              ),
              ...(replacement.changed
                ? artistAliasStatements(ctx, winner, command.input.artistId, rows)
                : []),
            ],
            assertApplied: winner,
            outcome,
          }
        },
      }
    }).pipe(
      Effect.catchTag('McpToolError', (error) =>
        error.code === 'invalid_input' ||
        error.code === 'not_found' ||
        error.code === 'conflict' ||
        error.code === 'unavailable'
          ? Effect.succeed({ status: error.code })
          : Effect.fail(error),
      ),
    )

    const result = yield* Effect.tryPromise({
      try: () =>
        store.execute({
          key: {
            actorId: initial.actorId,
            clientId: initial.clientId,
            resource: initial.resource,
            operation: command.operation,
            requestId: command.input.requestId,
          },
          normalizedInput: command.input,
          now,
          authorize: async (outcome) => {
            const checked = await runPromise(
              Effect.result(authority.checkpoint(['catalogue:write'])),
            )

            if (Result.isFailure(checked)) {
              if (checked.failure.code === 'access_denied') return false
              throw checked.failure
            }

            if (!sameAuthority(initial, checked.success)) return false

            if (!outcome) return true

            if (
              !Schema.is(FactsTarget)(outcome.access) ||
              outcome.access.entityId !== target.entityId ||
              outcome.access.entityType !== target.entityType
            )
              return false

            return Boolean(await runPromise(factsTargetExists(db, target)))
          },
          prepare: () => runPromise(prepare),
        }),
      catch: factsUnavailable,
    })

    if (result.status !== 'applied' && result.status !== 'replayed')
      return yield* new McpToolError({
        code: result.status,
        message:
          'Music facts write did not return success; retry only the identical request after an unavailable result.',
      })

    const saved = yield* Schema.decodeUnknownEffect(SavedFacts)(result.outcome.result).pipe(
      Effect.mapError(factsUnavailable),
    )

    const response = {
      status: result.status,
      operationId: result.operationId,
      createdAt: result.createdAt,
      expiresAt: result.expiresAt,
      ...saved,
    }

    if (wire.successBytes(response) > 256 * 1024) return yield* invalid()

    return response
  })

  return {
    readRecordingCredits,
    readArtistAliases,
    setRecordingCredits: Effect.fn('MusicFacts.setCredits')(function* (
      raw: Schema.Json,
      now: number,
      wire: MusicFactsWire,
    ) {
      return yield* apply(
        { operation: 'set_recording_credits', input: yield* parseRecordingCredits(raw) },
        now,
        wire,
      )
    }),
    setArtistAliases: Effect.fn('MusicFacts.setAliases')(function* (
      raw: Schema.Json,
      now: number,
      wire: MusicFactsWire,
    ) {
      return yield* apply(
        { operation: 'set_artist_aliases', input: yield* parseArtistAliases(raw) },
        now,
        wire,
      )
    }),
  }
})

/** Authority is request-scoped, never captured in the singleton data layer.
 * @effect-expect-leaking CommandAuthority
 * @effect-expect-leaking McpAuthorization
 */
export class MusicFactsService extends Context.Service<
  MusicFactsService,
  Effect.Success<typeof makeService>
>()('gbfm/mcp/MusicFacts') {}

export const MusicFactsServiceLive = Layer.effect(MusicFactsService, makeService)
