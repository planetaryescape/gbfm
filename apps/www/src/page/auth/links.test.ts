import { expect, it } from 'vitest'

import { authHref, safeReturnPath, signInHref } from '../../domain/auth/links'

it('carries only the params that have a value', () => {
  expect(authHref('/auth/sign-up', { returnTo: '/privacy' })).toBe(
    '/auth/sign-up?returnTo=%2Fprivacy',
  )
  expect(authHref('/auth/sign-up', { returnTo: '' })).toBe('/auth/sign-up')
})

it('links to sign in with the current page, except from auth pages', () => {
  expect(signInHref('/privacy')).toBe('/auth/sign-in?returnTo=%2Fprivacy')
  expect(signInHref('/auth/reset-password')).toBe('/auth/sign-in')
})

it('only returns to same-origin pages outside of auth', () => {
  const origin = 'https://goosebumps.fm'
  expect(safeReturnPath('/privacy?tab=1', origin)).toBe('/privacy?tab=1')
  expect(safeReturnPath('', origin)).toBe('/dashboard')
  expect(safeReturnPath('https://evil.example/steal', origin)).toBe('/dashboard')
  expect(safeReturnPath('//evil.example', origin)).toBe('/dashboard')
  expect(safeReturnPath('/auth/sign-in', origin)).toBe('/dashboard')
  expect(safeReturnPath('/authors', origin)).toBe('/authors')
})
