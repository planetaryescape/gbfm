import type { ComponentRef, Ref } from 'react'
import { Text, TextInput } from 'react-native'

import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { segmentText } from '@/tweets/tagText'

export function ComposerInput({
  ref,
  text,
  editable,
  placeholder,
  onChangeText,
  onCursorChange,
}: {
  readonly ref: Ref<ComponentRef<typeof TextInput>>
  readonly text: string
  readonly editable: boolean
  readonly placeholder: string
  readonly onChangeText: (text: string) => void
  readonly onCursorChange: (cursor: number) => void
}) {
  const colors = useThemeColors()

  return (
    <TextInput
      ref={ref}
      accessibilityLabel='Tweet'
      onSelectionChange={({ nativeEvent }) => onCursorChange(nativeEvent.selection.end)}
      autoFocus
      multiline
      scrollEnabled={false}
      editable={editable}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      selectionColor={colors.accent}
      style={{
        color: colors.strong,
        fontFamily: fonts.mono,
        fontSize: 18,
        lineHeight: 27,
        minHeight: 120,
        padding: 0,
        textAlignVertical: 'top',
      }}>
      {segmentText(text).map((segment) => (
        <Text
          key={segment.offset}
          style={segment.kind === 'text' ? undefined : { color: colors.accent }}>
          {segment.value}
        </Text>
      ))}
    </TextInput>
  )
}
