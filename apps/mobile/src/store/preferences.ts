import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { Effect, Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { type PropsWithChildren, useEffect } from 'react'
import { Appearance } from 'react-native'

import { readLocal, writeLocal } from './localStorage'

export type ColorSchemePreference = 'system' | 'light' | 'dark'

const colorSchemePreference = Atom.make<ColorSchemePreference>('system').pipe(Atom.keepAlive)

const Preference = Schema.Literals(['system', 'light', 'dark'])

const key = 'gbfm-appearance'

const preferencesReady = Atom.make(false).pipe(Atom.keepAlive)

const applyPreference = (
  value: ColorSchemePreference,
  setPreference: (value: ColorSchemePreference) => void,
) => {
  Appearance.setColorScheme(value === 'system' ? 'auto' : value)
  setPreference(value)
}

export const useColorSchemePreference = () => useAtomValue(colorSchemePreference)

export const useSetColorSchemePreference = () => {
  const setPreference = useAtomSet(colorSchemePreference)

  return (value: ColorSchemePreference) =>
    writeLocal(key, value).pipe(
      Effect.tap(() => Effect.sync(() => applyPreference(value, setPreference))),
    )
}

export function PreferencesProvider({ children }: PropsWithChildren) {
  const setPreference = useAtomSet(colorSchemePreference)
  const ready = useAtomValue(preferencesReady)
  const setReady = useAtomSet(preferencesReady)
  useEffect(() => {
    Effect.runSync(
      readLocal(key).pipe(
        Effect.flatMap((value) =>
          value === null
            ? Effect.succeed('system' as const)
            : Schema.decodeUnknownEffect(Preference)(value),
        ),
        Effect.match({
          onSuccess: (value) => applyPreference(value, setPreference),
          onFailure: () => applyPreference('system', setPreference),
        }),
      ),
    )
    setReady(true)
  }, [setPreference, setReady])

  return ready ? children : null
}
