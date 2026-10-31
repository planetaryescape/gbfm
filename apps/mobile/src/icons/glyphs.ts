export type GlyphPaths = {
  readonly fill?: string
  readonly stroke?: string
}

export const glyphs = {
  heart: { stroke: 'M3 5H9V8H15V5H21V14H18V17H15V20H9V17H6V14H3Z' },
  play: { fill: 'M6 4V20H10V17H14V14H18V10H14V7H10V4Z' },
  pause: { fill: 'M6 4H10V20H6Z M14 4H18V20H14Z' },
  previous: { fill: 'M4 4H7V20H4Z M20 4V20H17V17H14V14H10V10H14V7H17V4Z' },
  next: { fill: 'M17 4H20V20H17Z M4 4V20H7V17H10V14H14V10H10V7H7V4Z' },
  sleeve: { stroke: 'M3 3H21V21H3Z M8 8H16V16H8Z', fill: 'M11 11H13V13H11Z' },
  warning: { stroke: 'M12 3L22 20H2Z M12 9V13', fill: 'M11 15H13V17H11Z' },
  chevronUp: { stroke: 'M6 15L12 9L18 15' },
  chevronDown: { stroke: 'M6 9L12 15L18 9' },
  chevronLeft: { stroke: 'M15 6L9 12L15 18' },
  chevronRight: { stroke: 'M9 6L15 12L9 18' },
  shuffle: {
    stroke: 'M3 6H6L18 18H21 M17 14L21 18L17 22 M3 18H6L10 14 M14 10L18 6H21 M17 2L21 6L17 10',
  },
  close: { stroke: 'M6 6L18 18 M18 6L6 18' },
  check: { stroke: 'M4 12L9 17L20 6' },
} as const satisfies Record<string, GlyphPaths>

export type GlyphName = keyof typeof glyphs
