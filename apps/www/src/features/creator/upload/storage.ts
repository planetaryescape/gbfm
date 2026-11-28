import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { StorageQuotaError } from './errors'
import { parsePersistedUpload, type PersistedResumableUpload } from './protocol'

const KEY = (fingerprint: string) => `gbfm:resumable-upload:${fingerprint}`

export interface ResumableUploadStorageService {
  read: (fileFingerprint: string) => Effect.Effect<PersistedResumableUpload | null>
  write: (value: PersistedResumableUpload) => Effect.Effect<void, StorageQuotaError>
  clear: (fileFingerprint: string) => Effect.Effect<void, StorageQuotaError>
}

export class ResumableUploadStorage extends Context.Service<
  ResumableUploadStorage,
  ResumableUploadStorageService
>()('@gbfm/www/ResumableUploadStorage') {}

export const ResumableUploadStorageLive = Layer.sync(ResumableUploadStorage, () => ({
  read: (fingerprint: string) =>
    Effect.sync(() => {
      try {
        const raw = window.localStorage.getItem(KEY(fingerprint))

        if (!raw) return null

        return parsePersistedUpload(JSON.parse(raw))
      } catch {
        return null
      }
    }),
  write: (value: PersistedResumableUpload) =>
    Effect.try({
      try: () => window.localStorage.setItem(KEY(value.fileFingerprint), JSON.stringify(value)),
      catch: () => new StorageQuotaError({ message: 'Could not persist the upload checkpoint.' }),
    }),
  clear: (fingerprint: string) =>
    Effect.try({
      try: () => window.localStorage.removeItem(KEY(fingerprint)),
      catch: () => new StorageQuotaError({ message: 'Could not clear the upload checkpoint.' }),
    }),
}))

export const ResumableUploadStorageTest = Layer.succeed(ResumableUploadStorage, {
  read: () => Effect.succeed(null),
  write: () => Effect.void,
  clear: () => Effect.void,
})

export const ResumableUploadStorageInMemory = Layer.sync(ResumableUploadStorage, () => {
  const store = new Map<string, PersistedResumableUpload>()

  return {
    read: (fingerprint: string) => Effect.sync(() => store.get(fingerprint) ?? null),
    write: (value: PersistedResumableUpload) =>
      Effect.sync(() => {
        store.set(value.fileFingerprint, value)
      }),
    clear: (fingerprint: string) =>
      Effect.sync(() => {
        store.delete(fingerprint)
      }),
  }
})

export const readCheckpoint = (fingerprint: string) =>
  Effect.andThen(ResumableUploadStorage, (s) => s.read(fingerprint))

export const writeCheckpoint = (value: PersistedResumableUpload) =>
  Effect.andThen(ResumableUploadStorage, (s) => s.write(value))

export const clearCheckpoint = (fingerprint: string) =>
  Effect.andThen(ResumableUploadStorage, (s) => s.clear(fingerprint))
