import type { McpScope } from '@gbfm/core/editorial-mcp'
import { sql, type SQL } from 'drizzle-orm'
import { Clock, Context, Effect, Layer, Option, Result, Schema } from 'effect'

import { Database } from '@/db/layer'
import { omitUndefined } from '@/lib/omit-undefined'
import { CommandAuthority } from '@/mcp/command-authority'
import { McpToolError } from '@/mcp/contracts'
import { EditorialMcpConfig } from '@/mcp/editorial'
import { createArtworkStageStatement } from '@/mcp/operations/staged-store'
import { McpOperationStore, type OperationOutcome } from '@/mcp/operations/store'
import { MAX_MCP_RESPONSE_BYTES, McpWireResponse } from '@/mcp/wire-response'
import { CanonicalMusicIdentity } from '@/services/canonical-music-identity'
import {
  MusicIdentityAuthorizationFailed,
  MusicIdentityProviderUnavailable,
  MusicIdentityStorageError,
} from '@/services/canonical-music-identity/errors'
import { CanonicalImportPersistence } from '@/services/canonical-music-identity/import-persistence'
import { parseMusicSource } from '@/services/canonical-music-identity/music-source'
import type {
  CanonicalCommit,
  EntityReference,
} from '@/services/canonical-music-identity/repository'

import { MusicImportArtwork } from './artwork'
import type { ImportMusicUrlInput } from './commands'
import { MusicImportExecutionAuthority } from './execution-authority'
import { projectImportPersistence } from './outcome'

export const MusicImportCatalogue = Schema.Struct({
  disposition: Schema.Literals(['created', 'reused']),
  entityType: Schema.Literals(['artist', 'album', 'track']),
  entityId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,200}$/)),
  revision: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
  sourceKey: Schema.NonEmptyString,
  canonicalUrl: Schema.NonEmptyString,
})

export const MusicImportResult = Schema.Struct({
  operationId: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  receipt: Schema.Literals(['applied', 'replayed', 'expired']),
  completion: Schema.Literals(['complete', 'pending_artwork', 'partial']),
  catalogue: MusicImportCatalogue,
  artwork: Schema.Struct({
    phase: Schema.Literals([
      'preserved',
      'pending',
      'uploading',
      'association_pending',
      'delivered',
      'failed',
    ]),
    associatedRevision: Schema.NullOr(MusicImportCatalogue.fields.revision),
    failureCode: Schema.NullOr(
      Schema.Literals([
        'access_denied',
        'target_missing',
        'stale_revision',
        'source_unavailable',
        'artifact_rejected',
      ]),
    ),
  }),
})

export const musicImportScopes: ReadonlyArray<McpScope> = [
  'catalogue:write',
  'catalogue:import',
  'providers:read',
]

export const MusicImportPreparationBudget = Context.Reference<number>(
  'gbfm/MusicImportPreparationBudget',
  { defaultValue: () => 45000 },
)

const fail = (code: McpToolError['code'], message: string) => new McpToolError({ code, message })

const unavailable = () =>
  fail('unavailable', 'Import outcome may be committed. Retry only identical input and requestId.')

const tables = { artist: 'music_artists', album: 'music_albums', track: 'music_tracks' }

const makeService = Effect.gen(function* () {
  const db = yield* Database
  const execution = yield* MusicImportExecutionAuthority
  const operations = yield* McpOperationStore
  const artwork = yield* MusicImportArtwork
  const canonical = yield* CanonicalMusicIdentity
  const endpoint = yield* EditorialMcpConfig
  const preparationBudget = yield* MusicImportPreparationBudget

  const execute = Effect.fn('MusicUrlImport.execute')(function* (
    raw: typeof ImportMusicUrlInput.Type,
    mode: 'import' | 'status' = 'import',
  ) {
    const availableAuthority = yield* Effect.serviceOption(CommandAuthority)

    if (Option.isNone(availableAuthority))
      return yield* fail('access_denied', 'Import authority is required.')
    const authority = availableAuthority.value
    const first = yield* authority.checkpoint(musicImportScopes)

    const prepared = yield* execution.check(
      { operation: 'import_music_url', input: raw },
      endpoint.resourceUrl,
    )

    if (prepared.command.operation !== 'import_music_url')
      return yield* fail('invalid_input', 'Expected a URL import.')
    const input = prepared.command.input

    const source = yield* parseMusicSource(input.url, input.expectedType).pipe(
      Effect.mapError(() => fail('invalid_input', 'Invalid music source.')),
    )

    if (input.expectedType === 'playlist' || source.sourceEntityType === 'playlist')
      return yield* fail('invalid_input', 'Playlist imports are not enabled through MCP.')

    const wire = yield* Effect.serviceOption(McpWireResponse)

    const maximumResponse = {
      endpoint,
      import: {
        operationId: 'x'.repeat(64),
        receipt: 'replayed',
        completion: 'pending_artwork',
        catalogue: {
          disposition: 'created',
          entityType: 'artist',
          entityId: 'x'.repeat(200),
          revision: Number.MAX_SAFE_INTEGER,
          sourceKey: source.sourceKey,
          canonicalUrl: source.canonicalUrl,
        },
        artwork: {
          phase: 'association_pending',
          associatedRevision: Number.MAX_SAFE_INTEGER,
          failureCode: 'source_unavailable',
        },
      },
    }

    if (Option.isNone(wire) || wire.value.successBytes(maximumResponse) > MAX_MCP_RESPONSE_BYTES)
      return yield* fail(
        'invalid_input',
        'A bounded request response is required before importing music.',
      )

    if (
      first.actorId !== prepared.receiptScope.actorId ||
      first.clientId !== prepared.receiptScope.clientId ||
      first.resource !== prepared.receiptScope.resource
    )
      return yield* fail('access_denied', 'Import authority does not match this endpoint.')
    const { requestId: _requestId, ...normalizedInput } = input
    const key = prepared.receiptScope
    const services = yield* Effect.context()
    let applied = false

    const checkpoint = Effect.fn('MusicUrlImport.checkpoint')(function* (
      type?: EntityReference['entityType'],
    ) {
      if (type === 'playlist')
        return yield* fail('access_denied', 'Playlist imports are not enabled through MCP.')
      const current = yield* authority.checkpoint(musicImportScopes)

      if (
        current.actorId !== key.actorId ||
        current.clientId !== key.clientId ||
        current.resource !== key.resource
      )
        return yield* fail('access_denied', 'Import authority changed.')

      return current
    })

    const authorize = async (outcome?: OperationOutcome) => {
      const check = await Effect.runPromiseWith(services)(checkpoint().pipe(Effect.result))

      if (Result.isFailure(check)) {
        if (check.failure.code === 'access_denied') return false
        throw new Error('Import authority unavailable')
      }

      if (!outcome) return true
      const saved = Schema.decodeUnknownOption(MusicImportCatalogue)(outcome.result)

      if (Option.isNone(saved) || saved.value.sourceKey !== source.sourceKey) return false

      return Boolean(
        await db.get(
          sql`SELECT 1 FROM ${sql.identifier(tables[saved.value.entityType])} WHERE id = ${saved.value.entityId} AND (${check.success.liveGuard}) AND EXISTS (SELECT 1 FROM music_source_identities WHERE source_key = ${source.sourceKey} AND state = 'resolved' AND entity_type = ${saved.value.entityType} AND entity_id = ${saved.value.entityId})`,
        ),
      )
    }

    const lookup = () =>
      Effect.tryPromise({
        try: async () =>
          operations.lookup({
            key,
            normalizedInput,
            now: await Effect.runPromiseWith(services)(Clock.currentTimeMillis),
            authorize,
          }),
        catch: unavailable,
      })

    const persist = Effect.fn('MusicUrlImport.persist')(function* (
      reference: EntityReference,
      commit?: {
        readonly input: CanonicalCommit
        readonly build: (guard: SQL) => ReadonlyArray<D1PreparedStatement>
      },
    ) {
      if (reference.entityType === 'playlist')
        return yield* fail('access_denied', 'Playlist imports are not enabled through MCP.')
      const current = yield* checkpoint(reference.entityType)
      const table = sql.identifier(tables[reference.entityType])

      const row = yield* Effect.tryPromise({
        try: () => db.get(sql`SELECT revision FROM ${table} WHERE id = ${reference.entityId}`),
        catch: unavailable,
      })

      const observed = commit?.input.entity
        ? 0
        : yield* Schema.decodeUnknownEffect(
            Schema.Struct({ revision: MusicImportCatalogue.fields.revision }),
          )(row).pipe(
            Effect.map((value) => value.revision),
            Effect.mapError(unavailable),
          )

      const revision = commit && !commit.input.entity ? observed + 1 : observed

      const linkGuards: Array<SQL> = []

      if (commit) {
        const stored = yield* Effect.tryPromise({
          try: () =>
            db.all(
              sql`SELECT platform, url FROM music_entity_links WHERE entity_type = ${reference.entityType} AND entityId = ${reference.entityId}`,
            ),
          catch: unavailable,
        })

        const existing = yield* Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ platform: Schema.String, url: Schema.String })),
        )(stored).pipe(Effect.mapError(unavailable))

        for (const link of commit.input.links) {
          const allowed = [link.url]
          const previous = existing.find((value) => value.platform === link.platform)

          if (previous) {
            const before = yield* parseMusicSource(previous.url, reference.entityType).pipe(
              Effect.mapError(() =>
                fail('conflict', 'Existing link requires administrator reconciliation.'),
              ),
            )

            const after = yield* parseMusicSource(link.url, reference.entityType).pipe(
              Effect.mapError(() =>
                fail('conflict', 'Discovered link requires administrator reconciliation.'),
              ),
            )

            if (before.sourceKey !== after.sourceKey)
              return yield* fail(
                'conflict',
                'Discovered link conflicts with an existing exact source.',
              )
            allowed.push(previous.url)
          }

          linkGuards.push(
            sql`NOT EXISTS (SELECT 1 FROM music_entity_links WHERE entity_type = ${reference.entityType} AND entityId = ${reference.entityId} AND platform = ${link.platform} AND url NOT IN (${sql.join(
              allowed.map((url) => sql`${url}`),
              sql`, `,
            )}))`,
          )
        }
      }

      if (!Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER)
        return yield* fail('conflict', 'Catalogue revision is exhausted.')

      const catalogue = yield* Schema.decodeUnknownEffect(MusicImportCatalogue)({
        disposition: commit?.input.entity ? 'created' : 'reused',
        entityType: reference.entityType,
        entityId: reference.entityId,
        revision,
        sourceKey: source.sourceKey,
        canonicalUrl: source.canonicalUrl,
      }).pipe(Effect.mapError(unavailable))

      const now = yield* Clock.currentTimeMillis

      const result = yield* Effect.tryPromise({
        try: () =>
          operations.execute({
            key,
            normalizedInput,
            now,
            authorize,
            build: (context) => {
              const live = sql`(${context.fence}) AND (${current.liveGuard}) AND (${linkGuards.length ? sql.join(linkGuards, sql` AND `) : sql`1`})`

              const ownership = commit
                ? sql`(SELECT COUNT(*) FROM music_source_identities WHERE source_key IN (${sql.join(
                    commit.input.ownedSources.map((owned) => sql`${owned.sourceKey}`),
                    sql`, `,
                  )}) AND state = 'resolving' AND owner_token = ${commit.input.ownerToken} AND lease_expires_at > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) = ${commit.input.ownedSources.length}`
                : sql`1`

              const statements = commit
                ? [context.assert(sql`(${live}) AND (${ownership})`), ...commit.build(live)]
                : []

              const exactSource = sql`EXISTS (SELECT 1 FROM music_source_identities WHERE source_key = ${source.sourceKey} AND state = 'resolved' AND entity_type = ${reference.entityType} AND entity_id = ${reference.entityId})`

              if (commit)
                statements.push(
                  context.prepare(
                    sql`UPDATE ${table} SET revision = ${revision}, last_operation_id = ${context.attemptId} WHERE id = ${reference.entityId} AND revision = ${observed} AND (${live}) AND (${exactSource})`,
                  ),
                )

              const target = commit
                ? sql`EXISTS (SELECT 1 FROM ${table} WHERE id = ${reference.entityId} AND revision = ${revision} AND last_operation_id = ${context.attemptId})`
                : sql`EXISTS (SELECT 1 FROM ${table} WHERE id = ${reference.entityId} AND revision = ${revision})`

              const applied = sql`(${live}) AND (${target}) AND (${exactSource})`
              statements.push(context.assert(applied))

              if (input.artworkDelivery !== 'preserve')
                statements.push(
                  createArtworkStageStatement(context, {
                    disposition: catalogue.disposition,
                    entityType: reference.entityType,
                    entityId: reference.entityId,
                    catalogueRevision: revision,
                    sourceIdentityKey: source.sourceKey,
                    artworkPolicy: input.artworkDelivery,
                  }),
                )

              return {
                statements,
                assertApplied: applied,
                outcome: {
                  result: catalogue,
                  revision,
                  access: { entityType: reference.entityType, entityId: reference.entityId },
                },
              }
            },
          }),
        catch: unavailable,
      })

      if (result.status === 'applied') applied = true

      return result
    })

    let receipt = yield* lookup()

    if (receipt.status === 'miss') {
      if (mode === 'status')
        return yield* fail(
          'not_found',
          'No committed import receipt exists. An interrupted provider preparation may still be in progress.',
        )
      yield* checkpoint()

      const resolved = yield* canonical
        .resolveSource(
          omitUndefined({
            url: input.url,
            expectedType: input.expectedType,
            origin: 'manual' as const,
            artworkDelivery: 'preserve' as const,
            authorize: (type?: EntityReference['entityType']) =>
              execution
                .forSource(
                  { operation: 'import_music_url', input },
                  endpoint.resourceUrl,
                )(type)
                .pipe(
                  Effect.andThen(
                    checkpoint(type).pipe(
                      Effect.mapError(
                        (error) =>
                          new MusicIdentityAuthorizationFailed({
                            reason: error.code === 'access_denied' ? 'denied' : 'unavailable',
                          }),
                      ),
                    ),
                  ),
                  Effect.asVoid,
                ),
          }),
        )
        .pipe(
          Effect.provideService(CanonicalImportPersistence, {
            commit: (commit, build) =>
              persist(commit.reference, { input: commit, build }).pipe(
                Effect.flatMap((result) =>
                  result.status === 'applied' || result.status === 'replayed'
                    ? Effect.succeed(true)
                    : Effect.fail(unavailable()),
                ),
                Effect.mapError(
                  () =>
                    new MusicIdentityStorageError({
                      operation: 'import.commit',
                      message: 'Import receipt unavailable; reconcile the same request.',
                    }),
                ),
              ),
          }),
          Effect.timeoutOption(preparationBudget),
          Effect.flatMap((result) =>
            Option.isSome(result)
              ? Effect.succeed(result.value)
              : Effect.fail(
                  new MusicIdentityProviderUnavailable({
                    provider: source.platform,
                    message: 'Import preparation timed out; reconcile the identical request.',
                  }),
                ),
          ),
          Effect.result,
        )

      if (Result.isSuccess(resolved)) {
        const afterCommit = yield* lookup()

        if (afterCommit.status === 'miss') {
          yield* persist({
            entityType: resolved.success.entityType,
            entityId: resolved.success.entity.id,
          })
        }
      }

      receipt = yield* lookup()

      if (receipt.status === 'miss') {
        yield* projectImportPersistence(resolved)

        return yield* unavailable()
      }
    }

    let catalogue: typeof MusicImportCatalogue.Type
    let operationId: string

    if (receipt.status === 'expired') {
      const stage = yield* artwork.inspect({
        key,
        normalizedInput,
        checkpoint,
        sourceKey: source.sourceKey,
      })

      if (
        stage.status !== 'ready' ||
        stage.stage.original.entityType === 'playlist' ||
        stage.stage.original.entityType === 'label'
      )
        return yield* fail(
          'conflict',
          'Import receipt expired. The same key will not execute again.',
        )
      catalogue = yield* Schema.decodeUnknownEffect(MusicImportCatalogue)({
        ...stage.stage.original,
        revision: stage.stage.original.catalogueRevision,
        sourceKey: source.sourceKey,
        canonicalUrl: source.canonicalUrl,
      }).pipe(Effect.mapError(unavailable))
      operationId = stage.stage.operationId
    } else if (receipt.status === 'replayed') {
      catalogue = yield* Schema.decodeUnknownEffect(MusicImportCatalogue)(
        receipt.outcome.result,
      ).pipe(Effect.mapError(unavailable))
      operationId = receipt.operationId
    } else {
      return yield* fail(
        receipt.status,
        'Import receipt unavailable. Reconcile only the same requestId and input.',
      )
    }

    const enrichment =
      input.artworkDelivery === 'preserve'
        ? { phase: 'preserved' as const, associatedRevision: null, failureCode: null }
        : yield* artwork.run(
            { key, normalizedInput, checkpoint, sourceKey: source.sourceKey },
            mode === 'import',
          )

    yield* checkpoint(catalogue.entityType)

    return {
      operationId,
      receipt: applied ? ('applied' as const) : receipt.status,
      completion:
        enrichment.phase === 'preserved' || enrichment.phase === 'delivered'
          ? ('complete' as const)
          : enrichment.phase === 'failed'
            ? ('partial' as const)
            : ('pending_artwork' as const),
      catalogue,
      artwork: enrichment,
    }
  })

  return { execute }
})

export class MusicUrlImport extends Context.Service<
  MusicUrlImport,
  Effect.Success<typeof makeService>
>()('gbfm/mcp/MusicUrlImport') {}

export const MusicUrlImportLayer = Layer.effect(MusicUrlImport, makeService)
