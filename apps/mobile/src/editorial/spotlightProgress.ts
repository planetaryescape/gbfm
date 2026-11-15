import { Effect, Schema } from 'effect'

import { readLocal, writeLocal } from '@/store/localStorage'

import { emptyProgress, SpotlightProgress } from './progressState'

const StoredProgress = Schema.fromJsonString(SpotlightProgress)

const progressKey = (slug: string) => `gbfm-spotlight-${encodeURIComponent(slug)}.json`

export const readSpotlightProgress = (slug: string): SpotlightProgress =>
  Effect.runSync(
    readLocal(progressKey(slug)).pipe(
      Effect.flatMap((raw) =>
        raw === null
          ? Effect.succeed(emptyProgress)
          : Schema.decodeUnknownEffect(StoredProgress)(raw),
      ),
      Effect.orElseSucceed(() => emptyProgress),
    ),
  )

export const saveSpotlightProgress = (slug: string, progress: SpotlightProgress) =>
  Effect.runSync(
    Schema.encodeEffect(StoredProgress)(progress).pipe(
      Effect.flatMap((raw) => writeLocal(progressKey(slug), raw)),
      Effect.ignore,
    ),
  )
