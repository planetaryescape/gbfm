import { it, expect } from '@effect/vitest'
import { Redacted, Schema } from 'effect'

import { FormUrl, safeFormLocation } from './safe-props'

it('form locations move bearer tokens out of snapshot-safe URLs', () => {
  const props = safeFormLocation(
    'https://example.test/auth/reset-password?token=disposable&returnTo=%2Flistening',
  )

  expect(props.url).not.toContain('disposable')
  expect(props.url).not.toContain('token=')
  expect(props.token && Redacted.value(props.token)).toBe('disposable')
  expect(JSON.stringify(props)).not.toContain('disposable')
  expect(Schema.is(FormUrl)('https://example.test/?token=disposable')).toBe(false)
})
