import { Effect, Schema } from 'effect'

import { LocalStorageFailed, readLocal, removeLocal, writeLocal } from '@/store/localStorage'

import { StoredTweetDraft, type TweetDraft, appendSharedText, normalizeStoredDraft } from './draft'

const draftKey = (identity: string) => `gbfm-tweet-draft-${encodeURIComponent(identity)}.json`

export const readTweetDraft = (identity: string) =>
  readLocal(draftKey(identity)).pipe(
    Effect.flatMap((value) =>
      value === null
        ? Effect.succeed(null)
        : Schema.decodeUnknownEffect(Schema.fromJsonString(StoredTweetDraft))(value).pipe(
            Effect.map(normalizeStoredDraft),
          ),
    ),
    Effect.mapError(
      () =>
        new LocalStorageFailed({
          message: 'Could not restore your tweet draft. It has not been overwritten.',
        }),
    ),
  )

export const saveTweetDraft = (identity: string, draft: TweetDraft) =>
  writeLocal(draftKey(identity), JSON.stringify(draft))

export const removeTweetDraft = (identity: string) => removeLocal(draftKey(identity))

export const restoreTweetDraft = (identity: string) =>
  Effect.gen(function* () {
    const own = yield* readTweetDraft(identity)

    if (identity === 'guest') return own
    const guest = yield* readTweetDraft('guest')

    if (!guest) return own

    const draft = own ? appendSharedText(own, guest.text) : guest

    yield* saveTweetDraft(identity, draft)
    yield* removeTweetDraft('guest')

    return draft
  })
