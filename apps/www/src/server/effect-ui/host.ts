import { Predicate } from 'effect'

import { renderDocument } from './document'
import {
  acceptsHtml,
  allowedMethods,
  classifyRequest,
  refusedMethods,
  resolvesToIndex,
  varyWith,
} from './request-policy'
import type { DocumentAssets, ServerEntry } from './types'

export { renderDocument } from './document'

export const handleRequest = async (
  request: Request,
  entry: ServerEntry,
  assets: DocumentAssets,
): Promise<Response> => {
  const method = request.method.toUpperCase()

  if (refusedMethods.has(method))
    return new Response(null, { status: 405, headers: { allow: allowedMethods } })

  let negotiated = false

  if ((method === 'GET' || method === 'HEAD') && !resolvesToIndex(request.url)) {
    const classification = classifyRequest(request)

    if (classification === 'PathAsset') return new Response(null, { status: 404 })

    if (classification === 'DestinationAsset')
      return new Response(null, { status: 404, headers: { vary: 'Sec-Fetch-Dest' } })
    negotiated = true

    if (!acceptsHtml(request.headers.get('accept')))
      return new Response(null, {
        status: 404,
        headers: { vary: 'Accept, Sec-Fetch-Dest' },
      })
  }

  const result = await entry.renderPage(request)
  let response: Response

  if (Predicate.isTagged(result, 'Responded')) response = result.response
  else {
    const headers = new Headers(result.headers)
    headers.set('content-type', 'text/html; charset=utf-8')
    response = new Response(renderDocument(result.application, assets), {
      status: result.status,
      headers,
    })
  }

  if (method !== 'HEAD' && !negotiated) return response
  const headers = new Headers(response.headers)

  if (negotiated) headers.set('vary', varyWith(headers.get('vary'), 'Accept', 'Sec-Fetch-Dest'))

  if (method === 'HEAD') await response.body?.cancel()

  return new Response(method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
