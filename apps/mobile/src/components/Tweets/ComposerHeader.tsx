import { Stack } from 'expo-router'

import { useThemeColors } from '@/theme/colors'

export function ComposerHeader({
  signedIn,
  busy,
  label,
  disabled,
  onCancel,
  onSubmit,
  onSignIn,
}: {
  readonly signedIn: boolean
  readonly busy: boolean
  readonly label: string
  readonly disabled: boolean
  readonly onCancel: () => void
  readonly onSubmit: () => void
  readonly onSignIn: () => void
}) {
  const colors = useThemeColors()

  return (
    <>
      <Stack.Screen options={{ headerBackVisible: false }} />
      <Stack.Toolbar placement='left'>
        <Stack.Toolbar.Button
          icon='xmark'
          accessibilityLabel='Cancel'
          disabled={busy}
          onPress={onCancel}
        />
      </Stack.Toolbar>
      <Stack.Toolbar placement='right'>
        {signedIn ? (
          <Stack.Toolbar.Button
            variant='prominent'
            tintColor={colors.accent}
            disabled={busy || disabled}
            onPress={onSubmit}>
            {busy ? 'Saving' : label}
          </Stack.Toolbar.Button>
        ) : (
          <Stack.Toolbar.Button variant='prominent' tintColor={colors.accent} onPress={onSignIn}>
            Sign in
          </Stack.Toolbar.Button>
        )}
      </Stack.Toolbar>
    </>
  )
}
