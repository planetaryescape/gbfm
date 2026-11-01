import type { ColorValue } from 'react-native'
import Svg, { Path } from 'react-native-svg'

import { type GlyphName, type GlyphPaths, glyphs } from './glyphs'

export function Glyph({
  name,
  size = 24,
  color,
}: {
  readonly name: GlyphName
  readonly size?: number
  readonly color: ColorValue
}) {
  const paths: GlyphPaths = glyphs[name]

  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      accessibilityElementsHidden
      importantForAccessibility='no-hide-descendants'>
      {paths.fill ? <Path d={paths.fill} fill={color} /> : null}
      {paths.stroke ? (
        <Path
          d={paths.stroke}
          fill='none'
          stroke={color}
          strokeWidth={2}
          strokeLinecap='square'
          strokeLinejoin='miter'
        />
      ) : null}
    </Svg>
  )
}
