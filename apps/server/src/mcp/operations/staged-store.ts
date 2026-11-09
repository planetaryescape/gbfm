import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { sql, type SQL } from 'drizzle-orm'
import { Context, Effect, Layer, Schema } from 'effect'

import { canonicalJson, operationIdentity, prepareOperationStatement } from './persistence'
import type { JsonValue, OperationContext, OperationKey } from './store'

const sourcePattern =
  /^(?:url:sha256:[0-9a-f]{64}|spotify:(?:artist|album|track|playlist):[A-Za-z0-9]{1,256}|deezer:(?:artist|album|track|playlist):[0-9]{1,256}|youtube:(?:video|playlist):[A-Za-z0-9_-]{1,256})$/

const entityType = Schema.Literals(['artist', 'album', 'track', 'label', 'playlist'])

const phase = Schema.Literals([
  'pending',
  'uploading',
  'association_pending',
  'delivered',
  'failed',
])

const failure = Schema.Literals([
  'access_denied',
  'target_missing',
  'stale_revision',
  'source_unavailable',
  'artifact_rejected',
])

const artifactSchema = Schema.Struct({
  sha256: Schema.String,
  contentType: Schema.Literals(['image/jpeg', 'image/png', 'image/webp']),
  byteLength: Schema.Number,
  objectKey: Schema.String,
})

const seedSchema = Schema.Struct({
  disposition: Schema.Literals(['created', 'reused']),
  entityType,
  entityId: Schema.String,
  catalogueRevision: Schema.Number,
  sourceIdentityKey: Schema.String,
  artworkPolicy: Schema.Literals(['required', 'best_effort']),
})

/** Catalogue commit evidence. Source key MUST be canonical-parser output, never a URL. */
export type ArtworkStageSeed = typeof seedSchema.Type

/** Frozen byte snapshot and operation-specific immutable object identity. */
export type ArtworkArtifact = typeof artifactSchema.Type

/** Fresh physical lease attempt; generation increases on every acquire/takeover. */
export interface ArtworkLease {
  readonly attemptId: string
  readonly generation: number
}

/** Original disposition/revision stay separate from mutable enrichment state. */
export interface ArtworkStage {
  readonly operationId: string
  readonly original: {
    readonly disposition: ArtworkStageSeed['disposition']
    readonly entityType: ArtworkStageSeed['entityType']
    readonly entityId: string
    readonly catalogueRevision: number
  }
  readonly sourceIdentityKey: string | null
  readonly artworkPolicy: ArtworkStageSeed['artworkPolicy']
  readonly phase: typeof phase.Type
  readonly artifact: ArtworkArtifact | null
  readonly lease: (ArtworkLease & { readonly expiresAt: number }) | null
  readonly associatedRevision: number | null
  readonly failureCode: typeof failure.Type | null
}

/** Reauthorization owns persisted grant/actual type/current entity access, also after result TTL. */
export interface ArtworkRequest {
  readonly key: OperationKey
  readonly normalizedInput: JsonValue
  readonly now: number
  readonly authorize: (stage?: ArtworkStage) => Promise<boolean>
  /** Current account/grant/type/target predicates evaluated inside EVERY mutation. */
  readonly liveGuard: SQL
}

/** No raw provider errors or private values appear in failures. */
export type ArtworkResult =
  | { readonly status: 'ready'; readonly stage: ArtworkStage }
  | { readonly status: 'leased'; readonly stage: ArtworkStage; readonly lease: ArtworkLease }
  | {
      readonly status:
        | 'busy'
        | 'conflict'
        | 'expired'
        | 'not_found'
        | 'access_denied'
        | 'invalid_input'
        | 'unavailable'
    }

/** Only definitive failures terminalize; ambiguous fetch/PUT/DB timeouts do not transition. */
export type ArtworkTransition =
  | { readonly phase: 'uploading'; readonly artifact: Omit<ArtworkArtifact, 'objectKey'> }
  | { readonly phase: 'association_pending' }
  | { readonly phase: 'failed'; readonly failureCode: typeof failure.Type }

/** Association uses its lease fence, not the atomic-only pending-receipt assertion. */
export interface ArtworkAssociationContext extends Omit<OperationContext, 'assert'> {
  readonly stage: ArtworkStage
}

/** CAS, association and revision update join the final delivered transition in ONE batch. */
export interface ArtworkAssociationPlan {
  readonly statements: ReadonlyArray<D1PreparedStatement>
  readonly assertApplied: SQL
}

const validRevision = (revision: number) =>
  Number.isSafeInteger(revision) && revision >= 0 && revision < Number.MAX_SAFE_INTEGER

const validNow = (now: number) =>
  Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(now + 60000)

const validLease = (lease: ArtworkLease) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(lease.attemptId) &&
  Number.isSafeInteger(lease.generation) &&
  lease.generation > 0

const validArtifact = (artifact: ArtworkArtifact, operationId: string, type: string, id: string) =>
  /^[0-9a-f]{64}$/.test(artifact.sha256) &&
  Number.isInteger(artifact.byteLength) &&
  artifact.byteLength >= 1 &&
  artifact.byteLength <= 10 * 1024 * 1024 &&
  artifact.objectKey === `music/${type}/${id}/imports/${operationId}/${artifact.sha256}/cover`

/** Fixed safe categories only, never SQL/errors/keys/source/artifact/outcome data. */
export interface ArtworkDiagnostic {
  readonly operation: 'artwork.lookup' | 'artwork.authorize' | 'artwork.write' | 'artwork.prune'
  readonly dependency: 'database' | 'authorization'
  readonly code: 'storage_failed' | 'authorization_failed'
}

/** Append to the original catalogue AtomicOperationPlan; a failed catalogue assertion rolls this back. */
export const createArtworkStageStatement = (
  context: OperationContext,
  input: ArtworkStageSeed,
): D1PreparedStatement => {
  const seed = Schema.decodeUnknownSync(seedSchema)(input)

  if (
    !sourcePattern.test(seed.sourceIdentityKey) ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(seed.entityId) ||
    !validRevision(seed.catalogueRevision)
  )
    throw new Error('Invalid artwork seed')

  return context.prepare(sql`INSERT INTO mcp_operation_artwork
    (operation_id,actor_id,client_id,disposition,entity_type,entity_id,catalogue_revision,source_identity_key,artwork_policy,phase)
    SELECT ${context.operationId},actor_id,client_id,${seed.disposition},${seed.entityType},${seed.entityId},${seed.catalogueRevision},${seed.sourceIdentityKey},${seed.artworkPolicy},'pending'
    FROM mcp_operations WHERE id = ${context.operationId} AND ${context.fence}`)
}

const decodeRow = Schema.decodeUnknownSync(
  Schema.Struct({
    operation_id: Schema.String,
    disposition: Schema.NullOr(seedSchema.fields.disposition),
    entity_type: entityType,
    entity_id: Schema.String,
    catalogue_revision: Schema.Number,
    source_identity_key: Schema.NullOr(Schema.String),
    artwork_policy: seedSchema.fields.artworkPolicy,
    phase,
    artifact: Schema.NullOr(Schema.String),
    lease_attempt_id: Schema.NullOr(Schema.String),
    lease_generation: Schema.Number,
    lease_expires_at: Schema.NullOr(Schema.Number),
    associated_revision: Schema.NullOr(Schema.Number),
    failure_code: Schema.NullOr(failure),
    retired: Schema.Literals([0, 1]),
  }),
)

/** Shared staged persistence only: no network, byte upload, scheduler or artifact deletion. */
export const createMcpArtworkStore = (
  database: D1Database,
  report: (event: ArtworkDiagnostic) => void = (event) =>
    Effect.runSync(Effect.logError('mcp.artwork.unavailable', event)),
) => {
  const diagnostic = (event: ArtworkDiagnostic) => {
    try {
      report(event)
    } catch {
      /* Reporting cannot alter persisted outcomes. */
    }
  }

  const prepare = (statement: SQL) => prepareOperationStatement(database, statement)

  const readStage = async (operationId: string) => {
    const raw = await prepare(
      sql`SELECT * FROM mcp_operation_artwork WHERE operation_id = ${operationId}`,
    ).first()

    if (!raw) return undefined
    const row = decodeRow(raw)

    if (row.retired === 1) return { retired: true, stage: undefined }

    if (
      !validRevision(row.catalogue_revision) ||
      !Number.isSafeInteger(row.lease_generation) ||
      row.lease_generation < 0 ||
      row.disposition === null ||
      row.source_identity_key === null ||
      !sourcePattern.test(row.source_identity_key) ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(row.entity_id) ||
      (row.lease_attempt_id === null) !== (row.lease_expires_at === null)
    )
      throw new Error('Invalid artwork record')

    const artifact =
      row.artifact === null
        ? null
        : Schema.decodeUnknownSync(artifactSchema)(JSON.parse(row.artifact))

    if (
      (artifact !== null &&
        !validArtifact(artifact, operationId, row.entity_type, row.entity_id)) ||
      (row.phase === 'pending' && artifact !== null) ||
      (['uploading', 'association_pending', 'delivered'].includes(row.phase) &&
        artifact === null) ||
      (row.phase === 'failed') !== (row.failure_code !== null) ||
      (row.phase === 'delivered' && row.associated_revision !== row.catalogue_revision + 1) ||
      (row.lease_attempt_id !== null &&
        (row.lease_expires_at === null ||
          !Number.isSafeInteger(row.lease_expires_at) ||
          !validLease({ attemptId: row.lease_attempt_id, generation: row.lease_generation })))
    )
      throw new Error('Invalid artwork record')

    const stage: ArtworkStage = {
      operationId,
      original: {
        disposition: row.disposition,
        entityType: row.entity_type,
        entityId: row.entity_id,
        catalogueRevision: row.catalogue_revision,
      },
      sourceIdentityKey: row.source_identity_key,
      artworkPolicy: row.artwork_policy,
      phase: row.phase,
      artifact,
      lease:
        row.lease_attempt_id === null || row.lease_expires_at === null
          ? null
          : {
              attemptId: row.lease_attempt_id,
              generation: row.lease_generation,
              expiresAt: row.lease_expires_at,
            },
      associatedRevision: row.associated_revision,
      failureCode: row.failure_code,
    }

    return { stage, retired: false }
  }

  const run = async (
    input: ArtworkRequest,
    action: (stage: ArtworkStage, inputHash: string) => Promise<ArtworkResult>,
  ): Promise<ArtworkResult> => {
    if (!validNow(input.now)) return { status: 'invalid_input' }
    let identity: Awaited<ReturnType<typeof operationIdentity>>

    try {
      identity = await operationIdentity(input.key, input.normalizedInput)
    } catch {
      return { status: 'invalid_input' }
    }

    let event: ArtworkDiagnostic = {
      operation: 'artwork.authorize',
      dependency: 'authorization',
      code: 'authorization_failed',
    }

    try {
      if (!(await input.authorize())) return { status: 'access_denied' }
      event = { operation: 'artwork.lookup', dependency: 'database', code: 'storage_failed' }

      const raw = await prepare(
        sql`SELECT input_hash, expires_at FROM mcp_operations WHERE id = ${identity.operationId}`,
      ).first()

      if (!raw) return { status: 'not_found' }

      const receipt = Schema.decodeUnknownSync(
        Schema.Struct({ input_hash: Schema.String, expires_at: Schema.Number }),
      )(raw)

      if (receipt.input_hash !== identity.inputHash) return { status: 'conflict' }
      const record = await readStage(identity.operationId)

      if (!record) return { status: receipt.expires_at <= input.now ? 'expired' : 'not_found' }

      if (record.retired || !record.stage)
        return { status: receipt.expires_at <= input.now ? 'expired' : 'access_denied' }
      event = {
        operation: 'artwork.authorize',
        dependency: 'authorization',
        code: 'authorization_failed',
      }

      if (!(await input.authorize(record.stage))) return { status: 'access_denied' }

      if (receipt.expires_at <= input.now && ['delivered', 'failed'].includes(record.stage.phase))
        return { status: 'expired' }
      event = { operation: 'artwork.write', dependency: 'database', code: 'storage_failed' }
      const result = await action(record.stage, identity.inputHash)
      event = {
        operation: 'artwork.authorize',
        dependency: 'authorization',
        code: 'authorization_failed',
      }

      if (
        (result.status === 'ready' || result.status === 'leased') &&
        !(await input.authorize(result.stage))
      )
        return { status: 'access_denied' }

      return result
    } catch {
      diagnostic(event)

      return { status: 'unavailable' }
    }
  }

  const leaseFence = (
    input: ArtworkRequest,
    operationId: string,
    lease: ArtworkLease,
    inputHash: string,
  ) => sql`EXISTS (
    SELECT 1 FROM mcp_operation_artwork s JOIN mcp_operations r ON r.id = s.operation_id
    WHERE s.operation_id = ${operationId} AND r.input_hash = ${inputHash} AND s.retired = 0
    AND s.lease_attempt_id = ${lease.attemptId} AND s.lease_generation = ${lease.generation}
    AND s.lease_expires_at > ${input.now} AND s.phase IN ('pending','uploading','association_pending') AND (${input.liveGuard}))`

  const afterWrite = async (
    operationId: string,
    expected: (stage: ArtworkStage) => boolean,
  ): Promise<ArtworkResult> => {
    const record = await readStage(operationId)

    if (!record || record.retired || !record.stage || !expected(record.stage))
      return { status: 'conflict' }

    return { status: 'ready', stage: record.stage }
  }

  return {
    /** Trusted credential-deletion composition only, not a tool/user input endpoint. */
    async retireClient(
      clientId: string,
    ): Promise<{ readonly status: 'retired' | 'invalid_input' | 'unavailable' }> {
      if (clientId.length === 0 || clientId.length > 2048) return { status: 'invalid_input' }

      try {
        await database.batch([
          prepare(sql`UPDATE mcp_operation_artwork SET retired = 1, disposition = NULL, actor_id = NULL, client_id = NULL, source_identity_key = NULL, lease_attempt_id = NULL, lease_expires_at = NULL,
            failure_code = CASE WHEN phase IN ('delivered','failed') THEN failure_code ELSE 'access_denied' END,
            phase = CASE WHEN phase IN ('delivered','failed') THEN phase ELSE 'failed' END WHERE client_id = ${clientId}`),
          prepare(
            sql`UPDATE mcp_operations SET state = 'expired', actor_id = NULL, client_id = NULL, attempt_id = NULL, outcome = NULL WHERE client_id = ${clientId}`,
          ),
        ])

        return { status: 'retired' }
      } catch {
        diagnostic({ operation: 'artwork.prune', dependency: 'database', code: 'storage_failed' })

        return { status: 'unavailable' }
      }
    },
    /** Redact terminal recovery arguments after result TTL. NEVER delete artifacts or age out in-flight work. */
    async pruneTerminal(
      now: number,
    ): Promise<{ readonly status: 'pruned' | 'invalid_input' | 'unavailable' }> {
      if (!validNow(now)) return { status: 'invalid_input' }

      try {
        await prepare(sql`UPDATE mcp_operation_artwork SET retired = 1, disposition = NULL, actor_id = NULL, client_id = NULL, source_identity_key = NULL, lease_attempt_id = NULL, lease_expires_at = NULL
          WHERE retired = 0 AND phase IN ('delivered','failed') AND EXISTS (SELECT 1 FROM mcp_operations r WHERE r.id = operation_id AND r.expires_at <= ${now})`).run()

        return { status: 'pruned' }
      } catch {
        diagnostic({ operation: 'artwork.prune', dependency: 'database', code: 'storage_failed' })

        return { status: 'unavailable' }
      }
    },
    /** Same scoped key/hash only; an expired original result never reexecutes catalogue creation. */
    read: (input: ArtworkRequest) => run(input, async (stage) => ({ status: 'ready', stage })),

    /** Acquire/take over a 60s lease; terminal phases never reopen. Renew at 20s in the owning orchestrator. */
    acquire: (input: ArtworkRequest) =>
      run(input, async (stage) => {
        if (stage.phase === 'delivered' || stage.phase === 'failed')
          return { status: 'ready', stage }
        const attemptId = crypto.randomUUID()
        await prepare(sql`UPDATE mcp_operation_artwork SET lease_attempt_id = ${attemptId}, lease_generation = lease_generation + 1, lease_expires_at = ${input.now + 60000}
        WHERE operation_id = ${stage.operationId} AND retired = 0 AND phase IN ('pending','uploading','association_pending')
        AND lease_generation < 9007199254740991 AND (lease_attempt_id IS NULL OR lease_expires_at <= ${input.now}) AND (${input.liveGuard})`).run()
        const current = await readStage(stage.operationId)

        if (!current || current.retired || !current.stage) return { status: 'access_denied' }

        if (current.stage.lease?.attemptId !== attemptId) return { status: 'busy' }

        return {
          status: 'leased',
          stage: current.stage,
          lease: { attemptId, generation: current.stage.lease.generation },
        }
      }),

    /** Renewal cannot revive an expired or superseded physical attempt. */
    renew: (input: ArtworkRequest & { readonly lease: ArtworkLease }) =>
      run(input, async (stage, inputHash) => {
        if (!validLease(input.lease)) return { status: 'invalid_input' }
        const fence = leaseFence(input, stage.operationId, input.lease, inputHash)

        const written =
          await prepare(sql`UPDATE mcp_operation_artwork SET lease_expires_at = ${input.now + 60000}
        WHERE operation_id = ${stage.operationId} AND ${fence}`).run()

        if (written.meta.changes !== 1) return { status: 'conflict' }

        return afterWrite(
          stage.operationId,
          (current) =>
            current.lease?.attemptId === input.lease.attemptId &&
            current.lease.generation === input.lease.generation &&
            current.lease.expiresAt === input.now + 60000,
        )
      }),

    /** Caller proves object PUT/existence outside D1 before association_pending; never persist remote URLs. */
    transition: (
      input: ArtworkRequest & {
        readonly lease: ArtworkLease
        readonly transition: ArtworkTransition
      },
    ) =>
      run(input, async (stage, inputHash) => {
        if (!validLease(input.lease)) return { status: 'invalid_input' }
        const next = input.transition

        if (stage.phase === 'delivered' || stage.phase === 'failed') return { status: 'conflict' }
        const fence = leaseFence(input, stage.operationId, input.lease, inputHash)

        if (next.phase === 'uploading') {
          const candidate = {
            ...next.artifact,
            objectKey: `music/${stage.original.entityType}/${stage.original.entityId}/imports/${stage.operationId}/${next.artifact.sha256}/cover`,
          }

          if (
            !Schema.is(artifactSchema)(candidate) ||
            !validArtifact(
              candidate,
              stage.operationId,
              stage.original.entityType,
              stage.original.entityId,
            )
          )
            return { status: 'invalid_input' }
          const artifact = Schema.decodeUnknownSync(artifactSchema)(candidate)
          const encoded = canonicalJson({ ...artifact })

          if (stage.artifact !== null && canonicalJson({ ...stage.artifact }) !== encoded)
            return { status: 'conflict' }

          const written =
            await prepare(sql`UPDATE mcp_operation_artwork SET phase = 'uploading', artifact = ${encoded}
          WHERE operation_id = ${stage.operationId} AND phase IN ('pending','uploading') AND ${fence}`).run()

          if (written.meta.changes !== 1) return { status: 'conflict' }

          return afterWrite(
            stage.operationId,
            (current) =>
              current.phase === 'uploading' &&
              current.artifact?.sha256 === artifact.sha256 &&
              current.lease?.attemptId === input.lease.attemptId &&
              current.lease.expiresAt > input.now,
          )
        }

        if (next.phase === 'association_pending') {
          const written = await prepare(
            sql`UPDATE mcp_operation_artwork SET phase = 'association_pending' WHERE operation_id = ${stage.operationId} AND phase IN ('uploading','association_pending') AND ${fence}`,
          ).run()

          if (written.meta.changes !== 1) return { status: 'conflict' }

          return afterWrite(
            stage.operationId,
            (current) =>
              current.phase === 'association_pending' &&
              current.lease?.attemptId === input.lease.attemptId &&
              current.lease.expiresAt > input.now,
          )
        }

        if (!Schema.is(failure)(next.failureCode)) return { status: 'invalid_input' }
        const code = Schema.decodeUnknownSync(failure)(next.failureCode)

        const written =
          await prepare(sql`UPDATE mcp_operation_artwork SET phase = 'failed', failure_code = ${code}, lease_attempt_id = NULL, lease_expires_at = NULL
        WHERE operation_id = ${stage.operationId} AND ${fence}`).run()

        if (written.meta.changes !== 1) return { status: 'conflict' }

        return afterWrite(
          stage.operationId,
          (current) => current.phase === 'failed' && current.failureCode === code,
        )
      }),

    /** Domain CAS/association/revision and delivered evidence commit atomically; zero CAS ABORTS all writes. */
    associate: (
      input: ArtworkRequest & {
        readonly lease: ArtworkLease
        readonly build: (context: ArtworkAssociationContext) => ArtworkAssociationPlan
      },
    ) =>
      run(input, async (stage, inputHash) => {
        if (!validLease(input.lease)) return { status: 'invalid_input' }

        if (stage.phase === 'delivered') return { status: 'ready', stage }

        if (stage.phase !== 'association_pending') return { status: 'conflict' }
        const fence = sql`(${leaseFence(input, stage.operationId, input.lease, inputHash)}) AND EXISTS (SELECT 1 FROM mcp_operation_artwork WHERE operation_id = ${stage.operationId} AND phase = 'association_pending')`

        const plan = input.build({
          stage,
          operationId: stage.operationId,
          attemptId: input.lease.attemptId,
          fence,
          prepare,
        })

        // Finalization MUST execute even after a lost fence. A failing CHECK then aborts
        // the entire batch, including erroneously unconditional coupled domain DML.
        const finalize =
          prepare(sql`UPDATE mcp_operation_artwork SET phase = 'delivered', associated_revision = CASE WHEN (${fence}) AND (${plan.assertApplied}) THEN catalogue_revision + 1 ELSE -1 END,
        lease_attempt_id = NULL, lease_expires_at = NULL WHERE operation_id = ${stage.operationId}`)

        try {
          await database.batch([...plan.statements, finalize])
        } catch (cause) {
          if (
            cause instanceof Error &&
            (cause.message.includes('CHECK constraint failed: mcp_artwork_winner') ||
              cause.message.includes('mcp_artwork_immutable'))
          ) {
            const current = await readStage(stage.operationId)

            return current?.stage?.phase === 'delivered'
              ? { status: 'ready', stage: current.stage }
              : { status: 'conflict' }
          }

          diagnostic({ operation: 'artwork.write', dependency: 'database', code: 'storage_failed' })
          // A response can be lost after commit. Durable delivered evidence wins.
          const current = await readStage(stage.operationId)

          return current?.stage?.phase === 'delivered'
            ? { status: 'ready', stage: current.stage }
            : { status: 'unavailable' }
        }

        return afterWrite(stage.operationId, (current) => current.phase === 'delivered')
      }),
  }
}

/** Composition-provided common staged adapter; domain services never acquire a second ledger. */
export class McpArtworkStore extends Context.Service<
  McpArtworkStore,
  ReturnType<typeof createMcpArtworkStore>
>()('gbfm/mcp/ArtworkStore') {}

/** Supply the SAME env.DB as the atomic store and normal DatabaseLayer. */
export const McpArtworkStoreLayer = (database: D1Database) =>
  Layer.sync(McpArtworkStore, () => createMcpArtworkStore(database))
