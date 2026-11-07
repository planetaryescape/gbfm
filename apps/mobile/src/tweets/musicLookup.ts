import { Effect } from 'effect'

import type { MusicAttachment } from './draft'

export const lookupMusic = <E, R>(
  request: Effect.Effect<MusicAttachment, E, R>,
  onLoading: (loading: boolean) => void,
  onResolved: (music: MusicAttachment) => void,
) =>
  Effect.sleep('700 millis').pipe(
    Effect.tap(() => Effect.sync(() => onLoading(true))),
    Effect.andThen(request),
    Effect.timeout('20 seconds'),
    Effect.tap((music) => Effect.sync(() => onResolved(music))),
    Effect.ensuring(Effect.sync(() => onLoading(false))),
  )
