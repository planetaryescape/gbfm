import { Effect } from 'effect'

import { receiptStorageFromLocal } from '@/tweets/composerReceipts'

export const receiptStorageFixture = () => {
  const values = new Map<string, string>()

  const storage = receiptStorageFromLocal({
    read: (key) => Effect.sync(() => values.get(key) ?? null),
    write: (key, value) =>
      Effect.sync(() => {
        values.set(key, value)
      }),
    remove: (key) =>
      Effect.sync(() => {
        values.delete(key)
      }),
  })

  return { values, storage }
}
