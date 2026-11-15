import { Effect } from 'effect'
import { expect, test } from 'vitest'

import { validatePostEditContent } from './content'

test('validates the complete source with the canonical leading layout control marker', async () => {
  await expect(
    Effect.runPromise(
      validatePostEditContent(
        '::layout{name="spotlight"}\n\n![Art](https://example.test/art.png)\n\nProse.',
      ),
    ),
  ).resolves.toBeUndefined()
})

test.each([
  'Prose.\n\n::layout{name="spotlight"}',
  '::layout{name="spotlight"}\n\nProse.\n\n::layout{name="spotlight"}',
  '::layout{variant="spotlight"}\n\nProse.',
  '::layout{name="carousel"}\n\nProse.',
  '::layout{name="spotlight" extra="unsupported"}\n\nProse.',
  '::layout{name="spotlight"}\n\n::unknown{name="unsupported"}',
])('rejects misplaced, repeated, invalid or unsupported layout source: %s', async (source) => {
  await expect(Effect.runPromise(validatePostEditContent(source))).rejects.toMatchObject({
    code: 'invalid_input',
  })
})

test('does not treat a layout example inside a code block as a document control', async () => {
  await expect(
    Effect.runPromise(
      validatePostEditContent(
        '::layout{name="spotlight"}\n\nProse.\n\n```markdown\n::layout{name="spotlight"}\n```',
      ),
    ),
  ).resolves.toBeUndefined()
})
