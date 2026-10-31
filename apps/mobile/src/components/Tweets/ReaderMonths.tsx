import type { MicroPostTimelineMonth } from '@gbfm/api/navigation'
import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { readerMonth } from '@/tweets/readerState'

import { ReaderButton } from './ReaderButton'

export function ReaderMonths({
  timeline,
  onGo,
}: {
  readonly timeline: ReadonlyArray<MicroPostTimelineMonth>
  readonly onGo: (slug: string) => void
}) {
  const colors = useThemeColors()
  const months = [...timeline].sort((a, b) => b.month.localeCompare(a.month))
  const years = [...new Set(months.map((month) => month.month.slice(0, 4)))]
  const [year, setYear] = useState(years[0] ?? '')

  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12, lineHeight: 20 }}>
        Open a post from another time.
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}>
        {years.map((value) => (
          <ReaderButton
            key={value}
            label={value}
            primary={value === year}
            onPress={() => setYear(value)}
          />
        ))}
      </ScrollView>
      <View style={{ gap: 8 }}>
        {months
          .filter((month) => month.month.startsWith(year))
          .map((month) => (
            <ReaderButton
              key={month.month}
              label={readerMonth(`${month.month}-01T00:00:00Z`)}
              accessibilityLabel={`Visit ${readerMonth(`${month.month}-01T00:00:00Z`)}`}
              onPress={() => onGo(month.newestSlug)}
            />
          ))}
      </View>
    </View>
  )
}
