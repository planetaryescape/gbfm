import type { RichContentDocument } from '@gbfm/rich-content/schema'

import type { Model } from './model'

const spotlightPreview = (url: URL) =>
  import.meta.env.DEV && url.searchParams.get('layout') === 'spotlight'

/** The rich-content document of the editorial being shown when it reads as a spotlight walk. */
export const spotlightDocument = ({ flags }: Model): RichContentDocument | null => {
  const url = new URL(flags.url)
  const document = flags.items[0]?.richContent ?? null

  if (!url.pathname.startsWith('/editorial/') || document === null) return null

  return document.layout === 'spotlight' || spotlightPreview(url) ? document : null
}

/** Where the reader is in the walk: their stepped position, or the URL's when they have not stepped. */
export const spotlightProgress = ({ spotlight, flags }: Model) => {
  const url = new URL(flags.url)

  return spotlight !== null && spotlight.path === url.pathname
    ? spotlight
    : { path: url.pathname, at: url.searchParams.get('at'), seen: [] }
}
