import type { PropsWithChildren } from 'react'
import { Text, View, type StyleProp, type ViewStyle } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

const STRIPES = [0, 1, 2, 3, 4]

type Props = PropsWithChildren<{
  readonly background?: string
  readonly title?: string
  readonly striped?: boolean
  readonly style?: StyleProp<ViewStyle>
}>

function TitleBar({ title }: { readonly title: string | undefined }) {
  const colors = useThemeColors()

  return (
    <View
      style={{
        height: 15,
        marginHorizontal: 3,
        marginTop: 3,
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderColor: colors.strong,
      }}>
      {STRIPES.map((stripe) => (
        <View key={stripe} style={{ height: 1, backgroundColor: colors.strong, opacity: 0.55 }} />
      ))}
      {title ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            alignSelf: 'center',
            justifyContent: 'center',
            paddingHorizontal: 6,
            backgroundColor: colors.surface,
          }}>
          <Text style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 11 }}>
            {title}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

/** A classic desktop window: a hairline frame with a one-pixel drop shadow and an optional striped title bar. */
export function SquareFrame({ background, title, striped = false, style, children }: Props) {
  const colors = useThemeColors()

  return (
    <View style={{ marginRight: 1, marginBottom: 1 }}>
      <View
        style={{
          position: 'absolute',
          top: 1,
          left: 1,
          right: -1,
          bottom: -1,
          backgroundColor: colors.strong,
        }}
      />
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.strong,
          backgroundColor: background ?? colors.surface,
        }}>
        {striped || title ? <TitleBar title={title} /> : null}
        <View style={style}>{children}</View>
      </View>
    </View>
  )
}

/** Raised bevel edges for buttons, inverted while pressed. */
export const bevel = (pressed: boolean, light: string, shade: string): ViewStyle => ({
  borderWidth: 1,
  borderTopColor: pressed ? shade : light,
  borderLeftColor: pressed ? shade : light,
  borderBottomColor: pressed ? light : shade,
  borderRightColor: pressed ? light : shade,
})
