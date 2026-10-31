import { radii } from '@gbfm/theme'
import { View } from 'react-native'

import { Button } from '@/components/Button'
import { useThemeColors, withAlpha } from '@/theme/colors'

export function PlayerSheetHeader({ onClose }: { readonly onClose: () => void }) {
  const colors = useThemeColors()

  return (
    <View style={{ height: 56, flexShrink: 0, alignItems: 'flex-end', paddingHorizontal: 16 }}>
      <View
        style={{
          position: 'absolute',
          top: 8,
          left: '50%',
          marginLeft: -18,
          width: 36,
          height: 4,
          borderRadius: radii.control,
          backgroundColor: withAlpha(colors.muted, 0.45),
        }}
      />
      <View style={{ marginTop: 12 }}>
        <Button label='Close' variant='quiet' onPress={onClose} />
      </View>
    </View>
  )
}
