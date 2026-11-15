import { parseRichContent } from '@gbfm/rich-content/source'
import { Effect } from 'effect'

import { EditorialToolError } from '../contracts'

export const validatePostEditContent = (source: string | null | undefined) => {
  if (!source) return Effect.void
  const layout = /^\s*::layout\{[^\r\n]*\}[ \t]*(?:\r?\n|$)/.exec(source)
  const layoutLine = source.slice(0, source.indexOf('::layout')).split('\n').length

  const diagnostics = parseRichContent(source).diagnostics.filter(
    (item) =>
      !(
        layout &&
        item.code === 'unknown-directive' &&
        item.message === 'Unknown directive: layout' &&
        item.line === layoutLine
      ),
  )

  return diagnostics.length === 0
    ? Effect.void
    : Effect.fail(
        new EditorialToolError({
          code: 'invalid_input',
          message: 'Editorial content exceeds canonical limits or contains unsupported content.',
        }),
      )
}
