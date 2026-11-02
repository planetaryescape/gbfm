import { brandDark, brandLight } from '@gbfm/theme/tokens'
import { Effect } from 'effect'
import { useState } from 'react'
import { Pressable, Text, useColorScheme, View } from 'react-native'

import {
  type ColorSchemePreference,
  useColorSchemePreference,
  useSetColorSchemePreference,
} from '@/store/preferences'

const choices: ReadonlyArray<{
  readonly value: ColorSchemePreference
  readonly label: string
  readonly description: string
}> = [
  { value: 'system', label: 'System', description: 'Follow your device appearance.' },
  { value: 'light', label: 'Light', description: 'Use the light theme everywhere.' },
  { value: 'dark', label: 'Dark', description: 'Use the dark theme everywhere.' },
]

export function AppearanceSection() {
  const preference = useColorSchemePreference()
  const setPreference = useSetColorSchemePreference()
  const [error, setError] = useState<string | null>(null)
  const systemColorScheme = useColorScheme()
  const isDark = (preference === 'system' ? systemColorScheme : preference) !== 'light'
  const colors = isDark ? brandDark : brandLight

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors['pastel-green-1'], fontSize: 14, fontWeight: '600' }}>
        Appearance
      </Text>
      {choices.map((choice) => {
        const selected = choice.value === preference

        return (
          <Pressable
            accessibilityRole='radio'
            accessibilityState={{ selected }}
            key={choice.value}
            onPress={() =>
              Effect.runSync(
                setPreference(choice.value).pipe(
                  Effect.match({
                    onSuccess: () => setError(null),
                    onFailure: () => setError('Could not save your appearance choice. Try again.'),
                  }),
                ),
              )
            }
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              padding: 16,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: selected ? colors['pastel-green-1'] : `${colors['pastel-green-2']}55`,
              backgroundColor: colors.darkerBg,
              opacity: pressed ? 0.8 : 1,
            })}>
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 2,
                borderWidth: 2,
                borderColor: colors['pastel-green-1'],
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {selected ? (
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 1,
                    backgroundColor: colors['pastel-green-1'],
                  }}
                />
              ) : null}
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colors['pastel-green-1'], fontSize: 16, fontWeight: '600' }}>
                {choice.label}
              </Text>
              <Text style={{ color: colors.defaultText, fontSize: 14 }}>{choice.description}</Text>
            </View>
          </Pressable>
        )
      })}
      {error ? (
        <Text accessibilityRole='alert' style={{ color: colors.error }}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}
