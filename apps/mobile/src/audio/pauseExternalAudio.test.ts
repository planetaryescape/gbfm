import { expect, test } from 'vitest'

import { pauseExternalAudio } from './pauseExternalAudio'

test('an existing controller must actually pause successfully', async () => {
  const controller = {}
  expect(
    await pauseExternalAudio(
      () => controller,
      async () => false,
    ),
  ).toBe(false)
  expect(
    await pauseExternalAudio(
      () => controller,
      async () => true,
    ),
  ).toBe(true)
  await expect(
    pauseExternalAudio(
      () => controller,
      async () => {
        throw new Error('Pause failed')
      },
    ),
  ).rejects.toThrow('Pause failed')
})

test.each(['replaced', 'disposed'])(
  'a %s controller cannot grant playback ownership',
  async (change) => {
    let current: object | null = {}
    expect(
      await pauseExternalAudio(
        () => current,
        async () => {
          current = change === 'replaced' ? {} : null

          return true
        },
      ),
    ).toBe(false)
  },
)
