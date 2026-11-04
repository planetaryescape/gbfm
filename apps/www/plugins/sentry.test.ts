import { expect, test } from 'vitest'

import { sentryBuildPlugins } from './sentry'

test('ordinary local and PR builds do not need an upload credential', () => {
  expect(sentryBuildPlugins({ upload: false, token: undefined, release: undefined })).toEqual([])
})

test('requested uploads fail before deployment when token or immutable release is absent', () => {
  expect(() => sentryBuildPlugins({ upload: true, token: undefined, release: undefined })).toThrow(
    'SENTRY_AUTH_TOKEN',
  )
  expect(() =>
    sentryBuildPlugins({ upload: true, token: 'disposable-not-a-credential', release: 'local' }),
  ).toThrow('immutable WWW release')
})
