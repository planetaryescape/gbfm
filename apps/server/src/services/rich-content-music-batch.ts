import type { MusicSnapshot, SafeUrl } from '@gbfm/rich-content/schema'
import { SafeUrl as SafeUrlSchema } from '@gbfm/rich-content/schema'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Data, Effect, Option, Predicate, Schema } from 'effect'

import type { DatabaseClient } from '@/db/layer'
import {
  musicAlbumsTable,
  musicEntityLinksTable,
  musicSourceAliasesTable,
  musicSourceIdentitiesTable,
  musicTracksTable,
} from '@/db/music-entity.schema'

import { parseMusicSource } from './canonical-music-identity/music-source'
import type { MusicReference } from './rich-content-music.service'

type Snapshot = typeof MusicSnapshot.Type

type Entity = { readonly entityType: 'album' | 'track'; readonly entityId: string }

class MusicBatchReadError extends Data.TaggedError('MusicBatchReadError')<{
  readonly cause: unknown
}> {}

const decodeUrl = Schema.decodeUnknownOption(SafeUrlSchema)

const safeUrl = (url: string | null | undefined): SafeUrl | null => Option.getOrNull(decodeUrl(url))

const resolveChunk = (db: DatabaseClient, references: ReadonlyArray<MusicReference>) =>
  Effect.gen(function* () {
    const sources = yield* Effect.forEach(references, (reference) =>
      Predicate.isTagged(reference, 'MusicUrl')
        ? parseMusicSource(reference.url, reference.entityType).pipe(
            Effect.catch(() => Effect.succeed(null)),
          )
        : Effect.succeed(null),
    )

    const parsed = sources.flatMap((source) => (source === null ? [] : [source]))

    const [aliases, identities] =
      parsed.length === 0
        ? [[], []]
        : yield* Effect.tryPromise({
            try: () =>
              db.batch([
                db
                  .select({
                    normalizedUrl: musicSourceAliasesTable.normalizedUrl,
                    identity: musicSourceIdentitiesTable,
                  })
                  .from(musicSourceAliasesTable)
                  .innerJoin(
                    musicSourceIdentitiesTable,
                    eq(musicSourceAliasesTable.sourceKey, musicSourceIdentitiesTable.sourceKey),
                  )
                  .where(
                    inArray(
                      musicSourceAliasesTable.normalizedUrl,
                      parsed.map((source) => source.normalizedUrl),
                    ),
                  ),
                db
                  .select()
                  .from(musicSourceIdentitiesTable)
                  .where(
                    inArray(
                      musicSourceIdentitiesTable.sourceKey,
                      parsed.map((source) => source.sourceKey),
                    ),
                  ),
              ]),
            catch: (cause) => new MusicBatchReadError({ cause }),
          })

    const aliasByUrl = new Map(aliases.map((row) => [row.normalizedUrl, row.identity]))
    const identityByKey = new Map(identities.map((row) => [row.sourceKey, row]))

    const entities = references.map((reference, index): Entity | null => {
      if (reference.entityType === 'playlist') return null

      if (Predicate.isTagged(reference, 'MusicCatalog'))
        return { entityType: reference.entityType, entityId: reference.entityId }
      const source = sources[index]

      if (!source) return null
      const alias = aliasByUrl.get(source.normalizedUrl)

      if (alias && alias.sourceKey !== source.sourceKey) return null
      const identity = alias ?? identityByKey.get(source.sourceKey)

      if (
        identity?.state !== 'resolved' ||
        identity.entityType !== reference.entityType ||
        !identity.entityId
      )
        return null

      return { entityType: reference.entityType, entityId: identity.entityId }
    })

    const albumIds = [
      ...new Set(
        entities.flatMap((entity) => (entity?.entityType === 'album' ? [entity.entityId] : [])),
      ),
    ]

    const trackIds = [
      ...new Set(
        entities.flatMap((entity) => (entity?.entityType === 'track' ? [entity.entityId] : [])),
      ),
    ]

    const withTracks = [
      ...new Set(
        entities.flatMap((entity, index) =>
          entity?.entityType === 'album' && references[index]?.showTracks ? [entity.entityId] : [],
        ),
      ),
    ]

    if (albumIds.length + trackIds.length === 0) return references.map(() => null)

    const [albums, tracks, albumLinks, trackLinks, albumTracks] = yield* Effect.tryPromise({
      try: () =>
        db.batch([
          db
            .select({
              id: musicAlbumsTable.id,
              title: musicAlbumsTable.title,
              artists: musicAlbumsTable.artistNames,
              image: musicAlbumsTable.coverImageUrl,
            })
            .from(musicAlbumsTable)
            .where(inArray(musicAlbumsTable.id, albumIds)),
          db
            .select({
              id: musicTracksTable.id,
              title: musicTracksTable.title,
              artists: musicTracksTable.artistNames,
              image: musicTracksTable.coverImageUrl,
            })
            .from(musicTracksTable)
            .where(inArray(musicTracksTable.id, trackIds)),
          db
            .select({
              entityType: musicEntityLinksTable.entityType,
              entityId: musicEntityLinksTable.entityId,
              platform: musicEntityLinksTable.platform,
              url: musicEntityLinksTable.url,
            })
            .from(musicEntityLinksTable)
            .where(
              and(
                eq(musicEntityLinksTable.status, 'verified'),
                eq(musicEntityLinksTable.entityType, 'album'),
                inArray(musicEntityLinksTable.entityId, albumIds),
              ),
            )
            .orderBy(asc(musicEntityLinksTable.platform)),
          db
            .select({
              entityType: musicEntityLinksTable.entityType,
              entityId: musicEntityLinksTable.entityId,
              platform: musicEntityLinksTable.platform,
              url: musicEntityLinksTable.url,
            })
            .from(musicEntityLinksTable)
            .where(
              and(
                eq(musicEntityLinksTable.status, 'verified'),
                eq(musicEntityLinksTable.entityType, 'track'),
                inArray(musicEntityLinksTable.entityId, trackIds),
              ),
            )
            .orderBy(asc(musicEntityLinksTable.platform)),
          db
            .select({
              albumId: musicTracksTable.albumId,
              title: musicTracksTable.title,
              artists: musicTracksTable.artistNames,
            })
            .from(musicTracksTable)
            .where(inArray(musicTracksTable.albumId, withTracks))
            .orderBy(asc(musicTracksTable.trackNumber), asc(musicTracksTable.title)),
        ]),
      catch: (cause) => new MusicBatchReadError({ cause }),
    })

    const albumById = new Map(albums.map((row) => [row.id, row]))
    const trackById = new Map(tracks.map((row) => [row.id, row]))
    const links = [...albumLinks, ...trackLinks]

    return references.map((reference, index): Snapshot | null => {
      const entity = entities[index]

      if (!entity) return null
      const row = (entity.entityType === 'album' ? albumById : trackById).get(entity.entityId)

      if (!row) return null

      const safeLinks = links
        .filter(
          (link) => link.entityType === entity.entityType && link.entityId === entity.entityId,
        )
        .flatMap((link) => {
          const url = safeUrl(link.url)

          return url === null ? [] : [{ platform: link.platform, url }]
        })

      return {
        ...entity,
        title: row.title,
        artists: row.artists ?? [],
        description: null,
        imageUrl: safeUrl(row.image),
        canonicalUrl: Predicate.isTagged(reference, 'MusicUrl')
          ? reference.url
          : (safeLinks.find((link) => link.platform === 'spotify')?.url ??
            safeLinks[0]?.url ??
            '/'),
        links: safeLinks,
        tracks:
          entity.entityType === 'album' && reference.showTracks
            ? albumTracks
                .filter((track) => track.albumId === entity.entityId)
                .map((track) => ({ title: track.title, artists: track.artists ?? [], url: null }))
            : [],
      }
    })
  })

export const resolveMusicBatch = (
  db: DatabaseClient,
  references: ReadonlyArray<MusicReference>,
  resolveSingle: (reference: MusicReference) => Effect.Effect<Snapshot | null>,
) =>
  Effect.gen(function* () {
    const results = new Map<MusicReference, Snapshot | null>()
    const catalog = references.filter((reference) => reference.entityType !== 'playlist')
    const chunks: Array<ReadonlyArray<MusicReference>> = []

    for (let index = 0; index < catalog.length; index += 20)
      chunks.push(catalog.slice(index, index + 20))
    yield* Effect.all(
      [
        Effect.forEach(
          chunks,
          (chunk) =>
            resolveChunk(db, chunk).pipe(
              Effect.catch(() =>
                Effect.logWarning('[rich-content] Music batch unavailable').pipe(
                  Effect.as(chunk.map(() => null)),
                ),
              ),
              Effect.tap((snapshots) =>
                Effect.sync(() => {
                  chunk.forEach((reference, index) =>
                    results.set(reference, snapshots[index] ?? null),
                  )
                }),
              ),
            ),
          { concurrency: 1 },
        ),
        Effect.forEach(
          references.filter((reference) => reference.entityType === 'playlist'),
          (reference) =>
            resolveSingle(reference).pipe(
              Effect.tap((snapshot) =>
                Effect.sync(() => {
                  results.set(reference, snapshot)
                }),
              ),
            ),
          { concurrency: 8 },
        ),
      ],
      { concurrency: 2 },
    )

    return references.map((reference) => results.get(reference) ?? null)
  })
