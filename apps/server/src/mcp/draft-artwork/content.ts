import { parseRichContent } from '@gbfm/rich-content/source'
import { Effect } from 'effect'

import { EditorialToolError } from '../contracts'

export const validatePostEditContent = (source: string | null | undefined) => {
  if (!source) return Effect.void
  const layout = /^\s*::layout\{[^\r\n]*\}[ \t]*(?:\r?\n|$)/.exec(source)
  const { document, diagnostics } = parseRichContent(source)

  const misplacedLayout =
    document.layout !== undefined &&
    (!layout || parseRichContent(source.slice(layout[0].length)).document.layout !== undefined)

  return diagnostics.length === 0 && !misplacedLayout
    ? Effect.void
    : Effect.fail(
        new EditorialToolError({
          code: 'invalid_input',
          message: 'Editorial content exceeds canonical limits or contains unsupported content.',
        }),
      )
}
