import { Effect } from 'effect'
import { useRouter } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { type ComponentRef, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'

import { login } from '@/api/auth'
import { Screen } from '@/components/Screen'
import { useSetAuth } from '@/store/auth'
import { LoginSubmission } from '@/store/loginSubmission'
import { useLoginSubmission } from '@/store/useLoginSubmission'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

export default function Login({ onSignedIn }: { readonly onSignedIn?: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const { submission, submit } = useLoginSubmission()
  const isSubmitting = LoginSubmission.$is('Submitting')(submission)

  const errorMessage = LoginSubmission.$match(submission, {
    Idle: () => undefined,
    Submitting: () => undefined,
    Failed: ({ message }) => message,
  })

  const router = useRouter()
  const setAuth = useSetAuth()
  const colors = useThemeColors()
  const headerHeight = useHeaderHeight()
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null)
  const canSubmit = email.trim().length > 0 && password.length > 0 && !isSubmitting

  const handleLogin = () => {
    if (!canSubmit) return

    void submit(login({ email: email.trim(), password }).pipe(Effect.tap(setAuth)), () =>
      onSignedIn ? onSignedIn() : router.replace('/profile'),
    )
  }

  return (
    <Screen topInset={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerHeight}
        style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps='handled'
          keyboardDismissMode='on-drag'
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
          <View style={{ gap: 32 }}>
            <View style={{ gap: 12 }}>
              <Text
                style={{
                  color: colors.muted,
                  fontFamily: fonts.mono,
                  fontSize: 12,
                  letterSpacing: 2.4,
                  textTransform: 'uppercase',
                }}>
                Goosebumps FM
              </Text>
              <Text
                style={{
                  color: colors.accent,
                  fontFamily: fonts.monoSemiBold,
                  fontSize: 28,
                  lineHeight: 36,
                }}>
                Welcome back.
              </Text>
              <Text
                style={{
                  color: colors.text,
                  fontFamily: fonts.mono,
                  fontSize: 14,
                  lineHeight: 22,
                }}>
                Sign in to save music, manage reminders, and pick up where you left off.
              </Text>
            </View>

            <View
              style={{
                gap: 20,
                padding: 20,
                backgroundColor: colors.surface,
                borderColor: `${colors.muted}55`,
                borderWidth: 1,
                borderRadius: 4,
              }}>
              <View style={{ gap: 8 }}>
                <Text
                  style={{ color: colors.accent, fontFamily: fonts.monoSemiBold, fontSize: 14 }}>
                  Email
                </Text>
                <TextInput
                  accessibilityLabel='Email'
                  autoCapitalize='none'
                  autoComplete='email'
                  autoCorrect={false}
                  keyboardType='email-address'
                  onChangeText={setEmail}
                  onSubmitEditing={() => passwordInput.current?.focus()}
                  submitBehavior='submit'
                  placeholder='you@example.com'
                  placeholderTextColor={`${colors.text}99`}
                  returnKeyType='next'
                  textContentType='emailAddress'
                  value={email}
                  style={{
                    minHeight: 52,
                    paddingHorizontal: 16,
                    color: colors.text,
                    borderColor: `${colors.muted}66`,
                    borderWidth: 1,
                    borderRadius: 4,
                    fontSize: 16,
                    fontFamily: fonts.mono,
                  }}
                />
              </View>

              <View style={{ gap: 8 }}>
                <Text
                  style={{ color: colors.accent, fontFamily: fonts.monoSemiBold, fontSize: 14 }}>
                  Password
                </Text>
                <View>
                  <TextInput
                    ref={passwordInput}
                    accessibilityLabel='Password'
                    autoCapitalize='none'
                    autoComplete='current-password'
                    onChangeText={setPassword}
                    onSubmitEditing={handleLogin}
                    placeholder='Your password'
                    placeholderTextColor={`${colors.text}99`}
                    returnKeyType='go'
                    secureTextEntry={!showPassword}
                    textContentType='password'
                    value={password}
                    style={{
                      minHeight: 52,
                      paddingLeft: 16,
                      paddingRight: 72,
                      color: colors.text,
                      borderColor: `${colors.muted}66`,
                      borderWidth: 1,
                      borderRadius: 4,
                      fontSize: 16,
                      fontFamily: fonts.mono,
                    }}
                  />
                  <Pressable
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    accessibilityRole='button'
                    hitSlop={12}
                    onPress={() => setShowPassword((visible) => !visible)}
                    style={{ position: 'absolute', right: 16, top: 16 }}>
                    <Text style={{ color: colors.muted, fontFamily: fonts.monoSemiBold }}>
                      {showPassword ? 'Hide' : 'Show'}
                    </Text>
                  </Pressable>
                </View>
              </View>

              {errorMessage ? (
                <Text
                  accessibilityRole='alert'
                  style={{ color: colors.error, fontFamily: fonts.mono, lineHeight: 20 }}>
                  {errorMessage}
                </Text>
              ) : null}

              <Pressable
                accessibilityRole='button'
                disabled={!canSubmit}
                onPress={handleLogin}
                style={({ pressed }) => ({
                  minHeight: 52,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 4,
                  backgroundColor: canSubmit ? colors.accent : `${colors.muted}66`,
                  opacity: pressed ? 0.8 : 1,
                })}>
                {isSubmitting ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text
                    style={{ color: colors.surface, fontFamily: fonts.monoSemiBold, fontSize: 14 }}>
                    Sign in
                  </Text>
                )}
              </Pressable>
            </View>

            <Text
              style={{
                color: `${colors.text}CC`,
                fontFamily: fonts.mono,
                textAlign: 'center',
                fontSize: 12,
              }}>
              Magic links and password recovery are coming next.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
