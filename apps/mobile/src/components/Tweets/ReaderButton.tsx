import { Button } from '@/components/Button'
import type { GlyphName } from '@/icons/glyphs'

export function ReaderButton({
  label,
  onPress,
  disabled = false,
  primary = false,
  selected = false,
  accessibilityLabel,
  glyph,
  quiet = false,
}: {
  readonly label: string
  readonly onPress: () => void
  readonly disabled?: boolean
  readonly primary?: boolean
  readonly selected?: boolean
  readonly accessibilityLabel?: string
  readonly glyph?: GlyphName
  readonly quiet?: boolean
}) {
  return (
    <Button
      label={label}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      selected={selected}
      onPress={onPress}
      variant={primary ? 'primary' : quiet ? 'quiet' : 'secondary'}
      {...(glyph ? { glyph } : {})}
    />
  )
}
