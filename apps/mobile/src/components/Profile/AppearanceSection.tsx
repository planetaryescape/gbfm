import { Effect } from 'effect'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import {
  type ColorSchemePreference,
  useColorSchemePreference,
  useSetColorSchemePreference,
} from '@/store/preferences'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { SettingsSection } from './SettingsSection'

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
  const colors = useThemeColors()

  return (
    <View style={{ gap: 12 }}>
      <SettingsSection title='Appearance'>
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
                      onFailure: () =>
                        setError('Could not save your appearance choice. Try again.'),
                    }),
                  ),
                )
              }
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                padding: 16,
                opacity: pressed ? 0.8 : 1,
              })}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text
                  style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 14 }}>
                  {choice.label}
                </Text>
                <Text
                  style={{
                    color: colors.muted,
                    fontFamily: fonts.mono,
                    fontSize: 12,
                    lineHeight: 18,
                  }}>
                  {choice.description}
                </Text>
              </View>
              <Text
                accessibilityElementsHidden
                importantForAccessibility='no'
                style={{ color: colors.accent, fontSize: 20, minWidth: 20, textAlign: 'center' }}>
                {selected ? '✓' : ''}
              </Text>
            </Pressable>
          )
        })}
      </SettingsSection>
      {error ? (
        <Text accessibilityRole='alert' style={{ color: colors.error, fontFamily: fonts.mono }}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}
