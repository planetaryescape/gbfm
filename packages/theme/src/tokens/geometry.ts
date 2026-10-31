export const radii = {
  artwork: 0,
  control: 4,
  surface: 4,
  overlay: 12,
  round: 9999,
} as const

export const controlMetrics = {
  height: 44,
  paddingInline: 12,
  gap: 8,
  fontSize: 14,
  iconSize: 20,
  borderWidth: 1,
} as const

export const geometryCSS = {
  radiusControl: `${radii.control}px`,
  radiusSurface: `${radii.surface}px`,
  radiusOverlay: `${radii.overlay}px`,
  radiusArtwork: `${radii.artwork}px`,
  radiusRound: `${radii.round}px`,
  controlHeight: `${controlMetrics.height}px`,
  controlPaddingInline: `${controlMetrics.paddingInline}px`,
  controlGap: `${controlMetrics.gap}px`,
  controlFontSize: `${controlMetrics.fontSize}px`,
  controlIconSize: `${controlMetrics.iconSize}px`,
} as const
