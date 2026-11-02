import { expect, test } from 'vitest'

import { readLimitedBody } from './read-limited-body'

test('bounds streamed UTF-8 bodies by bytes, including without a declared length', async () => {
  expect(
    await readLimitedBody(new Request('https://example.test', { method: 'POST', body: 'éé' }), 4),
  ).toBe('éé')
  expect(
    await readLimitedBody(new Request('https://example.test', { method: 'POST', body: 'éé' }), 3),
  ).toBeNull()
})
