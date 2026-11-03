import { Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { ReaderButton } from './ReaderButton'

export function ReadingProgress({
  newerUnread,
  canReturn,
  onLatest,
  onReturn,
}: {
  readonly newerUnread: boolean
  readonly canReturn: boolean
  readonly onLatest: () => void
  readonly onReturn: () => void
}) {
  const colors = useThemeColors()

  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}>
      {newerUnread ? (
        <Text
          accessibilityLiveRegion='polite'
          style={{ color: colors.strong, fontFamily: fonts.mono, fontSize: 12 }}>
          Newer unread tweets available
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <ReaderButton
          label={newerUnread ? 'View latest' : 'Latest'}
          primary={newerUnread}
          onPress={onLatest}
        />
        {canReturn ? <ReaderButton label='Back to where I was' onPress={onReturn} /> : null}
      </View>
    </View>
  )
}
