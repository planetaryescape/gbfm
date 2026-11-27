import { Match } from 'effect'

import type { AuthErrorKey } from './errors'

export type AuthField = 'name' | 'email' | 'password'

export type FieldState = { readonly invalid: boolean; readonly focus: boolean }

export const errorId = 'auth-error'

export const formFields = (action: string): ReadonlyArray<AuthField> =>
  Match.value(action).pipe(
    Match.when('sign-up', (): ReadonlyArray<AuthField> => ['name', 'email', 'password']),
    Match.when('forgot-password', (): ReadonlyArray<AuthField> => ['email']),
    Match.when('reset-password', (): ReadonlyArray<AuthField> => ['password']),
    Match.orElse((): ReadonlyArray<AuthField> => ['email', 'password']),
  )

const invalidFields = (key: AuthErrorKey): ReadonlyArray<AuthField> =>
  Match.value(key).pipe(
    Match.when('credentials', (): ReadonlyArray<AuthField> => ['email', 'password']),
    Match.when('exists', (): ReadonlyArray<AuthField> => ['email']),
    Match.whenOr('password', 'token', (): ReadonlyArray<AuthField> => ['password']),
    Match.orElse((): ReadonlyArray<AuthField> => []),
  )

export const fieldStates = (
  action: string,
  key: AuthErrorKey | null,
): Readonly<Record<AuthField, FieldState>> => {
  const fields = formFields(action)
  const invalid = key === null ? [] : invalidFields(key).filter((field) => fields.includes(field))
  const focused = key === null ? null : (invalid[0] ?? fields[0] ?? null)

  const state = (field: AuthField): FieldState => ({
    invalid: invalid.includes(field),
    focus: focused === field,
  })

  return { name: state('name'), email: state('email'), password: state('password') }
}
