import { Effect, Option, Schema } from 'effect'

import type { SelectMusicEntityLink } from '@/db/music-entity.schema'
import type { ScrapedLink } from '@/services/music-link-scraper.service'

import { parseMusicSource, type ParsedMusicSource } from './music-source'

type RecordingLink = Pick<ScrapedLink, 'url' | 'metadata'>

const RecordingEvidence = Schema.Struct({
  discoveredBy: Schema.Literal('musicbrainz'),
  confidence: Schema.Literal('exact_url'),
  mbidType: Schema.Literal('recording'),
  canonicalMbid: Schema.String.check(Schema.isUUID()),
  matchedUrl: Schema.String,
})

const exactRecording = (source: ParsedMusicSource, link: RecordingLink | undefined) =>
  Effect.gen(function* () {
    if (!link) return undefined
    const evidence = Schema.decodeUnknownOption(RecordingEvidence)(link.metadata)

    if (Option.isNone(evidence)) return undefined
    const metadata = evidence.value

    if (link.url !== `https://musicbrainz.org/recording/${metadata.canonicalMbid}`) {
      return undefined
    }

    const matched = yield* parseMusicSource(metadata.matchedUrl, 'track').pipe(
      Effect.catchTag('MusicSourceInvalid', () => Effect.succeed(undefined)),
    )

    return matched?.sourceKey === source.sourceKey ? metadata.canonicalMbid : undefined
  })

export const isVerifiedSpotifyRecordingAlias = (
  initial: ParsedMusicSource,
  previous: ParsedMusicSource,
  links: ReadonlyArray<ScrapedLink>,
  existingLinks: ReadonlyArray<SelectMusicEntityLink>,
) =>
  Effect.gen(function* () {
    if (
      initial.platform !== 'spotify' ||
      previous.platform !== 'spotify' ||
      initial.sourceEntityType !== 'track' ||
      previous.sourceEntityType !== 'track'
    ) {
      return false
    }

    const stored = existingLinks.find(
      (link) => link.platform === 'musicbrainz' && link.status === 'verified',
    )

    const original = yield* exactRecording(
      previous,
      stored ? { url: stored.url, metadata: stored.metadata ?? undefined } : undefined,
    )

    const proposed = yield* exactRecording(
      initial,
      links.find((link) => link.platform === 'musicbrainz'),
    )

    return original !== undefined && original === proposed
  })
