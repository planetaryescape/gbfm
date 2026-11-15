import { Effect } from 'effect'
import { expect, test } from 'vitest'

import { validatePostEditContent } from './content'

test('validates the complete source while preserving only the leading layout control marker', async () => {
  await expect(
    Effect.runPromise(
      validatePostEditContent(
        '::layout{variant="spotlight"}\n\n![Art](https://example.test/art.png)\n\nProse.',
      ),
    ),
  ).resolves.toBeUndefined()
  await expect(
    Effect.runPromise(validatePostEditContent('Prose.\n\n::layout{variant="spotlight"}')),
  ).rejects.toMatchObject({ code: 'invalid_input' })
  await expect(
    Effect.runPromise(
      validatePostEditContent('::layout{variant="spotlight"}\n\n::unknown{name="unsupported"}'),
    ),
  ).rejects.toMatchObject({ code: 'invalid_input' })
})
