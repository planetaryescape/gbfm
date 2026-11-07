import { sql } from 'drizzle-orm'
import { Context, Effect, Layer, Result, Schema } from 'effect'

import { Database } from '@/db/layer'
import { parseMusicSource } from '@/services/canonical-music-identity/music-source'

import { McpAuthorization, McpAuthorizationLive } from '../authorization'
import { EditorialToolError } from '../contracts'
import { MusicKind, MusicRef } from '../music-read/contracts'
import { MusicReadService } from '../music-read/service'
import {
  CompareSourcesResult,
  EquivalentResult,
  HealthResult,
  LinksResult,
  MissingLinksResult,
  Platform,
  StoredLink,
  type CompareSourcesInput,
  type EquivalentInput,
  type HealthInput,
  type LinkPageInput,
  type MissingLinksInput,
} from './contracts'
import { inspectLinkHealth, LinkHealthEgress } from './health'

const RawLink = Schema.Struct({
  linkId: Schema.String,
  entityType: MusicKind,
  platform: Platform,
  url: Schema.String,
  status: Schema.String,
  updatedAt: Schema.Number,
  verifiedAt: Schema.NullOr(Schema.Number),
})

const columns = sql`id as linkId, entity_type as entityType, platform, url, status, updatedAt, verifiedAt`

const unavailable = () =>
  new EditorialToolError({ code: 'unavailable', message: 'Music link inspection unavailable.' })

const make = Effect.gen(function* () {
  const db = yield* Database
  const music = yield* MusicReadService
  const authorization = yield* McpAuthorization
  const egress = yield* LinkHealthEgress

  const query = <A>(statement: ReturnType<typeof sql>, schema: Schema.Codec<A, unknown>) =>
    Effect.tryPromise({ try: () => db.all(statement), catch: unavailable }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(schema))),
      Effect.mapError(unavailable),
    )

  const bounded = <A>(value: A) => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        structuredContent: value,
        content: [{ type: 'text', text: JSON.stringify(value) }],
        isError: false,
      }),
    ).byteLength

    return bytes <= 232 * 1024
      ? Effect.succeed(value)
      : Effect.fail(
          new EditorialToolError({
            code: 'unavailable',
            message: 'Result exceeds response budget. Request a smaller page.',
          }),
        )
  }

  const safe = (row: typeof RawLink.Type | undefined) =>
    Effect.gen(function* () {
      if (!row || row.status !== 'verified') return null

      const parsed = yield* parseMusicSource(
        row.url,
        row.entityType === 'label' ? undefined : row.entityType,
      ).pipe(Effect.result)

      if (Result.isFailure(parsed)) return null

      const compatiblePlatform =
        parsed.success.platform === row.platform ||
        (parsed.success.platform === 'youtube' && row.platform === 'youtube_music') ||
        (parsed.success.platform === 'other' &&
          [
            'discord',
            'website',
            'instagram',
            'twitter',
            'musicbrainz',
            'discogs',
            'other',
          ].includes(row.platform))

      if (
        (row.entityType === 'label' && parsed.success.sourceEntityType !== 'url') ||
        !compatiblePlatform
      )
        return null

      const updatedAt = new Date(row.updatedAt)
      const verifiedAt = row.verifiedAt === null ? null : new Date(row.verifiedAt)

      if (
        !Number.isFinite(updatedAt.getTime()) ||
        (verifiedAt && !Number.isFinite(verifiedAt.getTime()))
      )
        return yield* unavailable()

      return yield* Schema.decodeUnknownEffect(StoredLink)({
        linkId: row.linkId,
        platform: row.platform,
        url: parsed.success.canonicalUrl,
        status: 'verified',
        observedUpdatedAt: updatedAt.toISOString(),
        verifiedAt: verifiedAt === null ? null : verifiedAt.toISOString(),
      }).pipe(Effect.mapError(unavailable))
    })

  const link = (input: typeof EquivalentInput.Type) =>
    query(
      sql`select ${columns} from music_entity_links
    where entity_type=${input.entityType} and entityId=${input.entityId} and platform=${input.platform} limit 1`,
      RawLink,
    ).pipe(Effect.flatMap((rows) => safe(rows[0])))

  const getMusicLinks = Effect.fn('LinkRead.getMusicLinks')(function* (
    input: typeof LinkPageInput.Type,
  ) {
    const { endpoint } = yield* music.getMusicEntity(input)
    const limit = input.limit ?? 20

    const rows = yield* query(
      sql`select ${columns} from music_entity_links
      where entity_type=${input.entityType} and entityId=${input.entityId} and platform > ${input.afterPlatform ?? ''}
      order by platform limit ${limit + 1}`,
      RawLink,
    )

    const window = rows.slice(0, limit)
    const links = (yield* Effect.forEach(window, safe)).filter((value) => value !== null)

    return yield* bounded(
      yield* Schema.decodeUnknownEffect(LinksResult)({
        endpoint,
        source: input,
        links,
        scanned: window.length,
        nextAfterPlatform: rows.length > limit ? (window.at(-1)?.platform ?? null) : null,
      }).pipe(Effect.mapError(unavailable)),
    )
  })

  const findPlatformEquivalent = Effect.fn('LinkRead.findPlatformEquivalent')(function* (
    input: typeof EquivalentInput.Type,
  ) {
    const { endpoint } = yield* music.getMusicEntity(input)
    const stored = yield* link(input)

    return yield* bounded(
      yield* Schema.decodeUnknownEffect(EquivalentResult)({
        endpoint,
        source: input,
        result: stored
          ? {
              status: 'stored_link',
              evidence: 'verified_link_of_same_catalogue_entry',
              link: stored,
            }
          : { status: 'insufficient_evidence' },
      }).pipe(Effect.mapError(unavailable)),
    )
  })

  const checkMusicLinkHealth = Effect.fn('LinkRead.checkMusicLinkHealth')(function* (
    input: typeof HealthInput.Type,
  ) {
    yield* authorization.requireScopes(['catalogue:read', 'providers:read'])
    const { endpoint } = yield* music.getMusicEntity(input)
    const stored = yield* link(input)

    return yield* bounded(
      yield* Schema.decodeUnknownEffect(HealthResult)({
        endpoint,
        source: input,
        link: stored,
        observation: stored
          ? yield* inspectLinkHealth(stored.url).pipe(
              Effect.provideService(LinkHealthEgress, egress),
            )
          : null,
        evidence: stored ? 'http_availability_only' : 'insufficient_stored_evidence',
      }).pipe(Effect.mapError(unavailable)),
    )
  })

  const findMissingPlatformLinks = Effect.fn('LinkRead.findMissingPlatformLinks')(function* (
    input: typeof MissingLinksInput.Type,
  ) {
    yield* authorization.catalogue
    const limit = input.limit ?? 20

    const table = {
      artist: sql`music_artists`,
      album: sql`music_albums`,
      track: sql`music_tracks`,
      label: sql`music_labels`,
    }[input.entityType]

    const rows = yield* query(
      sql`select ${input.entityType} as entityType, id as entityId
      from ${table} where id > ${input.afterId ?? ''} order by id limit ${limit + 1}`,
      MusicRef,
    )

    const endpoint = (yield* music.filterMusic({ entityType: input.entityType, limit: 1 })).endpoint
    const window = rows.slice(0, limit)
    const missing = []

    for (const ref of window)
      if (!(yield* link({ ...ref, platform: input.platform }))) missing.push(ref)

    return yield* bounded(
      yield* Schema.decodeUnknownEffect(MissingLinksResult)({
        endpoint,
        platform: input.platform,
        missing,
        scanned: window.length,
        nextAfterId: rows.length > limit ? (window.at(-1)?.entityId ?? null) : null,
      }).pipe(Effect.mapError(unavailable)),
    )
  })

  const compareMusicSources = Effect.fn('LinkRead.compareMusicSources')(function* (
    input: typeof CompareSourcesInput.Type,
  ) {
    const left = yield* music.lookupMusicUrl({ url: input.leftUrl })
    const right = yield* music.lookupMusicUrl({ url: input.rightUrl })

    const result =
      left.result.status !== 'found' || right.result.status !== 'found'
        ? { status: 'insufficient_evidence' }
        : left.result.entity.entityType === right.result.entity.entityType &&
            left.result.entity.entityId === right.result.entity.entityId
          ? { status: 'same_catalogue_entry', entity: left.result.entity }
          : {
              status: 'different_catalogue_entries',
              left: left.result.entity,
              right: right.result.entity,
            }

    return yield* bounded(
      yield* Schema.decodeUnknownEffect(CompareSourcesResult)({
        endpoint: left.endpoint,
        result,
        evidence: 'stored_identity_only_not_musical_equivalence',
      }).pipe(Effect.mapError(unavailable)),
    )
  })

  return {
    getMusicLinks,
    findPlatformEquivalent,
    checkMusicLinkHealth,
    findMissingPlatformLinks,
    compareMusicSources,
  }
})

export class LinkReadService extends Context.Service<
  LinkReadService,
  Effect.Success<typeof make>
>()('gbfm/mcp/LinkReadService') {}

/** Requires Database, MusicReadService and LinkHealthEgress; does not acquire a provider/import writer. */
export const LinkReadServiceLayer = Layer.effect(LinkReadService, make).pipe(
  Layer.provide(McpAuthorizationLive),
)
