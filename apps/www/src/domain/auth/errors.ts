import { Match, Option, Schema } from 'effect'

export const authErrorMessages = {
  credentials: "That email and password don't match.",
  exists: 'An account with this email already exists.',
  password: 'Use a password between 8 and 128 characters.',
  token: 'This reset link has expired or was already used.',
  rate: 'Too many attempts. Wait a minute and try again.',
  unknown: "That didn't go through. Check your details and try again.",
} as const

export type AuthErrorKey = keyof typeof authErrorMessages

const ErrorBody = Schema.Struct({ code: Schema.String })

export const readAuthErrorCode = async (response: Response): Promise<string> =>
  Option.match(Schema.decodeUnknownOption(ErrorBody)(await response.json().catch(() => null)), {
    onNone: () => '',
    onSome: ({ code }) => code,
  })

export const authErrorKey = (status: number, code: string): AuthErrorKey =>
  status === 429
    ? 'rate'
    : Match.value(code).pipe(
        Match.when('INVALID_EMAIL_OR_PASSWORD', (): AuthErrorKey => 'credentials'),
        Match.whenOr(
          'USER_ALREADY_EXISTS',
          'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
          (): AuthErrorKey => 'exists',
        ),
        Match.whenOr('PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG', (): AuthErrorKey => 'password'),
        Match.when('INVALID_TOKEN', (): AuthErrorKey => 'token'),
        Match.orElse((): AuthErrorKey => 'unknown'),
      )

const isAuthErrorKey = (key: string): key is AuthErrorKey => Object.hasOwn(authErrorMessages, key)

export const parseAuthErrorKey = (raw: string | null): AuthErrorKey | null =>
  Match.value(raw).pipe(
    Match.when(Match.null, () => null),
    Match.when('INVALID_TOKEN', (): AuthErrorKey => 'token'),
    Match.when(isAuthErrorKey, (key) => key),
    Match.orElse((): AuthErrorKey => 'unknown'),
  )

export const authErrorMessage = (raw: string | null): string | null => {
  const key = parseAuthErrorKey(raw)

  return key === null ? null : authErrorMessages[key]
}

type PreservedFields = {
  readonly returnTo: string
  readonly token: string
  readonly email: string
  readonly name: string
}

const preservedFields: ReadonlyArray<keyof PreservedFields> = ['returnTo', 'token', 'email', 'name']

export const authErrorLocation = (
  action: string,
  key: AuthErrorKey,
  form: PreservedFields,
): string => {
  const params = new URLSearchParams({ error: key })

  for (const field of preservedFields) if (form[field]) params.set(field, form[field])

  return `${action}?${params}`
}

export type AuthErrorAction = { readonly label: string; readonly path: string }

export const authErrorAction = (key: AuthErrorKey | null): AuthErrorAction | null =>
  Match.value(key).pipe(
    Match.when('credentials', (): AuthErrorAction => ({
      label: 'Reset your password',
      path: '/auth/forgot-password',
    })),
    Match.when('exists', (): AuthErrorAction => ({
      label: 'Sign in instead',
      path: '/auth/sign-in',
    })),
    Match.orElse(() => null),
  )
