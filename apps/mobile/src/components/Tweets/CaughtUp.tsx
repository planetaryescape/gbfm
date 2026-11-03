import { ActivityIndicator, Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { ReaderButton } from './ReaderButton'

export function CaughtUp({
  height,
  state,
  onRetry,
  onTop,
}: {
  readonly height: number
  readonly state: 'end' | 'loading' | 'failed'
  readonly onRetry: () => void
  readonly onTop: () => void
}) {
  const colors = useThemeColors()

  return (
    <View style={{ height, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
      {state === 'loading' ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <Text
            style={{
              color: colors.strong,
              fontFamily: fonts.monoSemiBold,
              fontSize: 18,
              textAlign: 'center',
            }}>
            {state === 'end' ? "You've reached the first tweet" : "Couldn't load older tweets"}
          </Text>
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.mono,
              fontSize: 13,
              textAlign: 'center',
            }}>
            {state === 'end'
              ? 'That is everything. Go listen to something.'
              : 'Check your connection.'}
          </Text>
          <ReaderButton
            label={state === 'end' ? 'Back to latest' : 'Retry'}
            onPress={state === 'end' ? onTop : onRetry}
          />
        </>
      )}
    </View>
  )
}
