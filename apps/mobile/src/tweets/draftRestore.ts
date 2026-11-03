import { Context, Effect } from 'effect'

import type { LocalStorageFailed } from '@/store/localStorage'

import { appendSharedText, type TweetDraft } from './draft'

export class TweetDraftStorage extends Context.Service<
  TweetDraftStorage,
  {
    readonly read: (identity: string) => Effect.Effect<TweetDraft | null, LocalStorageFailed>
    readonly save: (identity: string, draft: TweetDraft) => Effect.Effect<void, LocalStorageFailed>
    readonly remove: (identity: string) => Effect.Effect<void, LocalStorageFailed>
  }
>()('mobile/TweetDraftStorage') {}

export const restoreDraft = Effect.fn('restoreDraft')(function* (identity: string) {
  const storage = yield* TweetDraftStorage
  const own = yield* storage.read(identity)

  if (identity === 'guest') return own
  const guest = yield* storage.read('guest')

  if (!guest) return own

  const guestText = guest.text.trimEnd()

  const adopted =
    own &&
    (!guestText ||
      own.text.trimEnd() === guestText ||
      own.text.trimEnd().endsWith(`\n\n${guestText}`))

  const draft = own ? (adopted ? own : appendSharedText(own, guest.text)) : guest

  yield* storage.save(identity, draft)
  yield* storage.remove('guest')

  return draft
})
