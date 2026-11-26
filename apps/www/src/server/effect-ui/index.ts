import { Data } from 'effect'

import type { EntryResult, RenderedPage } from './types'

export type { DocumentAssets, EntryResult, RenderedPage } from './types'

export { renderDocument } from './document'

export { handleRequest } from './host'

const result = Data.taggedEnum<EntryResult>()

export const Rendered = (
  application: RenderedPage,
  options: { readonly status: number; readonly headers: HeadersInit },
): Extract<EntryResult, { readonly _tag: 'Rendered' }> =>
  result.Rendered({
    application,
    status: options.status,
    headers: new Headers(options.headers),
  })

export const Responded = (
  response: Response,
): Extract<EntryResult, { readonly _tag: 'Responded' }> =>
  result.Responded({
    response,
  })
