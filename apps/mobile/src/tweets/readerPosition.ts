import { Effect } from 'effect'

import { readLocal, writeLocal } from '@/store/localStorage'

const positionKey = (identity: string) => `gbfm-reader-position-${encodeURIComponent(identity)}.txt`

export const readReaderPosition = (identity: string) =>
  Effect.runSync(readLocal(positionKey(identity)).pipe(Effect.orElseSucceed(() => null)))

export const saveReaderPosition = (identity: string, slug: string) =>
  Effect.runSync(writeLocal(positionKey(identity), slug).pipe(Effect.ignore))
