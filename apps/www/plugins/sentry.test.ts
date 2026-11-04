import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { requirePrivateSourceMaps, sentryBuildPlugins } from './sentry'

test('ordinary local and PR builds do not need an upload credential', () => {
  expect(sentryBuildPlugins({ upload: false, token: undefined, release: undefined })).toEqual([])
})

test('deployment refuses leftover public source maps, including nested assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gbfm-private-maps-'))

  try {
    await mkdir(join(directory, 'assets'))
    await writeFile(join(directory, 'assets', 'client.js'), 'disposable fixture')
    await expect(requirePrivateSourceMaps(directory)).resolves.toBeUndefined()
    const map = join(directory, 'assets', 'client.js.map')
    await writeFile(map, '{}')
    await expect(requirePrivateSourceMaps(directory)).rejects.toThrow('remain in public assets')
    await rm(map)
    await expect(requirePrivateSourceMaps(directory)).resolves.toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('requested uploads fail before deployment when token or immutable release is absent', () => {
  expect(() => sentryBuildPlugins({ upload: true, token: undefined, release: undefined })).toThrow(
    'SENTRY_AUTH_TOKEN',
  )
  expect(() =>
    sentryBuildPlugins({ upload: true, token: 'disposable-not-a-credential', release: 'local' }),
  ).toThrow('immutable WWW release')
})
