import { Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { readerMonth, type ReaderState } from '@/tweets/readerState'

import { ReaderButton } from './ReaderButton'

export function ReaderHeader({
  date,
  onOptions,
  navigationStatus,
}: {
  readonly date: string
  readonly onOptions: () => void
  readonly navigationStatus: ReaderState['navigationStatus']
}) {
  const colors = useThemeColors()

  const hint = {
    ready: 'Swipe left for older · right for newer',
    error: 'Navigation unavailable · open Options to retry',
    loading: 'Loading navigation…',
  }[navigationStatus]

  return (
    <View style={{ gap: 2, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}>
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>
          {readerMonth(date)}
        </Text>
        <ReaderButton
          label='Options'
          accessibilityLabel='Reading options'
          glyph='chevronDown'
          quiet
          onPress={onOptions}
        />
      </View>
      <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>{hint}</Text>
    </View>
  )
}
