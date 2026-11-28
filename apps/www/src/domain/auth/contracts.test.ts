import { expect, it } from 'vitest'

import { authErrorAction, authErrorKey, authErrorLocation, parseAuthErrorKey } from './errors'
import { fieldStates, formFields } from './field-state'
import { authHref, safeReturnPath, signInHref } from './links'
import { verificationState } from './verification'

it('auth error contracts retain native redirect fields without ever adding a password', () => {
  expect(authErrorKey(429, '')).toBe('rate')
  expect(authErrorKey(400, 'INVALID_TOKEN')).toBe('token')
  expect(parseAuthErrorKey('INVALID_TOKEN')).toBe('token')
  expect(authErrorAction('exists')?.path).toBe('/auth/sign-in')

  const location = authErrorLocation('/auth/reset-password', 'password', {
    returnTo: '/listening',
    token: 'disposable-reset',
    email: '',
    name: '',
  })

  expect(new URL(location, 'https://example.test').searchParams.get('token')).toBe(
    'disposable-reset',
  )
  expect(location).not.toContain('password=')
})

it('field focus and verification state preserve the existing failure and success paths', () => {
  expect(formFields('reset-password')).toEqual(['password'])
  expect(fieldStates('sign-in', 'credentials').email).toEqual({ invalid: true, focus: true })
  expect(fieldStates('sign-in', 'credentials').password).toEqual({ invalid: true, focus: false })
  expect(verificationState(new URL('https://example.test/auth/verify-email?verified=1'))).toBe(
    'verified',
  )
  expect(
    verificationState(new URL('https://example.test/auth/verify-email?verified=1&error=expired')),
  ).toBe('failed')
})

it('auth links preserve local return destinations and reject external or recursive auth returns', () => {
  expect(authHref('/auth/sign-in', { returnTo: '/listening' })).toBe(
    '/auth/sign-in?returnTo=%2Flistening',
  )
  expect(signInHref('/auth/reset-password')).toBe('/auth/sign-in')
  expect(safeReturnPath('https://evil.test', 'https://example.test')).toBe('/dashboard')
  expect(safeReturnPath('/auth/sign-in', 'https://example.test')).toBe('/dashboard')
  expect(safeReturnPath('/listening?mix=a', 'https://example.test')).toBe('/listening?mix=a')
})
