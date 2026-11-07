import { linkStatusSchema } from '@gbfm/core/status'
import { sql } from 'drizzle-orm'
import { Effect, Result, Schema } from 'effect'

import { Database } from '@/db/layer'
import { MUSIC_PLATFORMS } from '@/db/music-entity.schema'
import {
  musicLinkStatements,
  type PreparedMusicLink,
} from '@/services/canonical-music-identity/link-statements'
import { parseMusicSource } from '@/services/canonical-music-identity/music-source'

import { CommandAuthority } from '../command-authority'
import { McpToolError } from '../contracts'
import { McpOperationStore } from '../operations/store'
import { LinkEditCommand, LinkPlatform, LinkTarget } from './contracts'

const tables = { artist: 'music_artists', album: 'music_albums', track: 'music_tracks' } as const

const ObservedLink = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(200)),
  platform: LinkPlatform,
  url: Schema.String.check(Schema.isMaxLength(2048)),
  status: linkStatusSchema,
})

const unavailable = () =>
  new McpToolError({
    code: 'unavailable',
    message: 'Music link command unavailable; retry identically.',
  })

const invalid = () =>
  new McpToolError({ code: 'invalid_input', message: 'Invalid music link command.' })

const parseSource = (url: string, type: typeof LinkTarget.Type.entityType) =>
  parseMusicSource(url, type).pipe(Effect.mapError(invalid))

const manualPlatforms = new Set([
  'discord',
  'website',
  'instagram',
  'twitter',
  'musicbrainz',
  'discogs',
  'other',
])

/** Manual link commands only. Provider preparation is a separate, required admitted boundary. */
export const applyMusicLink = Effect.fn('LinkEdit.apply')(function* (
  raw: Schema.Json,
  now: number,
) {
  const authority = yield* CommandAuthority
  const db = yield* Database
  const store = yield* McpOperationStore
  const runPromise = Effect.runPromiseWith(yield* Effect.context())
  const initial = yield* authority.checkpoint(['catalogue:write'])

  const command = yield* Schema.decodeUnknownEffect(LinkEditCommand)(raw, {
    onExcessProperty: 'error',
  }).pipe(Effect.mapError(invalid))

  const target = { entityType: command.entityType, entityId: command.entityId }
  let current = initial
  let preparationError: McpToolError | undefined

  const prepare = Effect.gen(function* () {
    const parent = yield* Effect.tryPromise({
      try: () =>
        db.get(sql`SELECT revision FROM ${sql.identifier(tables[target.entityType])}
        WHERE id=${target.entityId}`),
      catch: unavailable,
    })

    if (!parent) return { status: 'not_found' } as const

    const observedParent = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ revision: LinkEditCommand.fields.expectedRevision }),
    )(parent).pipe(Effect.mapError(unavailable))

    if (observedParent.revision !== command.expectedRevision) return { status: 'conflict' } as const

    const rows = yield* Effect.tryPromise({
      try: () =>
        db.all(sql`SELECT id,platform,url,status FROM music_entity_links
        WHERE entity_type=${target.entityType} AND entityId=${target.entityId}
        ORDER BY platform LIMIT ${MUSIC_PLATFORMS.length + 1}`),
      catch: unavailable,
    })

    const observed = yield* Schema.decodeUnknownEffect(Schema.Array(ObservedLink))(rows).pipe(
      Effect.mapError(unavailable),
    )

    if (observed.length > MUSIC_PLATFORMS.length) return yield* unavailable()

    const attach: Array<PreparedMusicLink> = []
    let release: Parameters<typeof musicLinkStatements>[0]['release']

    if (command.change.operation === 'attach_music_link') {
      const change = command.change
      const source = yield* parseSource(change.url, target.entityType)

      if (
        source.platform !== change.platform &&
        !(source.platform === 'youtube' && change.platform === 'youtube_music') &&
        !(source.platform === 'other' && manualPlatforms.has(change.platform))
      )
        return yield* invalid()

      const url = source.platform === change.platform ? source.canonicalUrl : source.normalizedUrl
      const existing = observed.find((link) => link.platform === change.platform)

      if (existing && (existing.status !== 'verified' || existing.url !== url)) {
        return { status: 'conflict' } as const
      }

      attach.push({ platform: change.platform, url, source })
    } else {
      const linkId = command.change.linkId
      const link = observed.find((candidate) => candidate.id === linkId)

      if (!link) return { status: 'not_found' } as const

      // Invalid stored URLs may still be rejected/removed; never guess their identity key.
      const source = yield* parseMusicSource(link.url, target.entityType).pipe(
        Effect.catchTag('MusicSourceInvalid', () => Effect.succeed(undefined)),
      )

      let keepIdentity = false

      for (const other of observed) {
        if (other.id === link.id || other.status !== 'verified') continue

        const parsed = yield* parseMusicSource(other.url, target.entityType).pipe(
          Effect.catchTag('MusicSourceInvalid', () => Effect.succeed(undefined)),
        )

        if (!parsed || parsed.sourceKey === source?.sourceKey) keepIdentity = true
      }

      release = {
        link,
        source,
        keepIdentity,
        action: command.change.operation === 'reject_music_link' ? 'reject' : 'remove',
      }
    }

    return {
      status: 'ready',
      build: (context: Parameters<typeof musicLinkStatements>[0]['context']) => ({
        ...musicLinkStatements({
          context,
          target,
          expectedRevision: command.expectedRevision,
          liveGuard: current.liveGuard,
          now,
          observed,
          attach,
          release,
        }),
        outcome: {
          result: { operation: command.change.operation, ...target },
          revision: { ...target, revision: command.expectedRevision + 1 },
          access: target,
        },
      }),
    } as const
  })

  const result = yield* Effect.tryPromise({
    try: () =>
      store.execute({
        key: {
          actorId: initial.actorId,
          clientId: initial.clientId,
          resource: initial.resource,
          operation: command.change.operation,
          requestId: command.requestId,
        },
        normalizedInput: command,
        now,
        authorize: async (outcome) => {
          const checked = await runPromise(Effect.result(authority.checkpoint(['catalogue:write'])))

          if (Result.isFailure(checked)) {
            if (checked.failure.code === 'access_denied') return false
            throw checked.failure
          }

          current = checked.success

          if (
            current.actorId !== initial.actorId ||
            current.clientId !== initial.clientId ||
            current.resource !== initial.resource
          )
            return false

          if (!outcome) return true

          if (
            !Schema.is(LinkTarget)(outcome.access) ||
            outcome.access.entityType !== target.entityType ||
            outcome.access.entityId !== target.entityId
          )
            return false

          return Boolean(
            await db.get(sql`SELECT 1 FROM ${sql.identifier(tables[target.entityType])}
          WHERE id=${target.entityId}`),
          )
        },
        prepare: async () => {
          const result = await runPromise(Effect.result(prepare))

          if (Result.isSuccess(result)) return result.success
          preparationError = result.failure

          return {
            status: result.failure.code === 'invalid_input' ? 'invalid_input' : 'unavailable',
          }
        },
      }),
    catch: unavailable,
  })

  if (result.status === 'invalid_input' && preparationError) return yield* preparationError

  return result
})
