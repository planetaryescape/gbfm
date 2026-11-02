import { Effect, Schema } from 'effect'
import { File, Paths } from 'expo-file-system'
import { Platform } from 'react-native'

export class LocalStorageFailed extends Schema.TaggedError<LocalStorageFailed>()(
  'LocalStorageFailed',
  { message: Schema.String },
) {}

export const readLocal = (key: string) =>
  Effect.try({
    try: () => {
      if (Platform.OS === 'web') return globalThis.localStorage.getItem(key)
      const file = new File(Paths.document, key)

      return file.exists ? file.textSync() : null
    },
    catch: () => new LocalStorageFailed({ message: 'Could not read saved data on this device.' }),
  })

export const writeLocal = (key: string, value: string) =>
  Effect.try({
    try: () => {
      if (Platform.OS === 'web') globalThis.localStorage.setItem(key, value)
      else new File(Paths.document, key).writeSync(value)
    },
    catch: () => new LocalStorageFailed({ message: 'Could not save data on this device.' }),
  })

export const removeLocal = (key: string) =>
  Effect.try({
    try: () => {
      if (Platform.OS === 'web') globalThis.localStorage.removeItem(key)
      else {
        const file = new File(Paths.document, key)

        if (file.exists) file.delete()
      }
    },
    catch: () => new LocalStorageFailed({ message: 'Could not remove saved data on this device.' }),
  })
