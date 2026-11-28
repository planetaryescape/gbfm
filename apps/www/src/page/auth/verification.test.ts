import { expect, it } from 'vitest'

import { verificationState } from '../../domain/auth/verification'

const at = (search: string) => new URL(`https://goosebumps.fm/auth/verify-email${search}`)

it('shows the inbox prompt when nothing has happened yet', () => {
  expect(verificationState(at(''))).toBe('pending')
})

it('confirms a verified email after better-auth redirects back', () => {
  expect(verificationState(at('?verified=1'))).toBe('verified')
})

it('treats any better-auth error as a failed link, even with the verified flag', () => {
  expect(verificationState(at('?verified=1&error=TOKEN_EXPIRED'))).toBe('failed')
  expect(verificationState(at('?error=INVALID_TOKEN'))).toBe('failed')
})
