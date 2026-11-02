import { readLimitedBody } from '@gbfm/core/http/read-limited-body'
import { MosaicRequest } from '@gbfm/rich-content/mosaic'
import { Option, Schema } from 'effect'

import { renderMosaic } from './mosaic'
import type { SocialCardRenderAssets } from './render-runtime'

export const handleMosaic = async (
  request: Request,
  assets: SocialCardRenderAssets,
): Promise<Response> => {
  if (request.method !== 'POST')
    return new Response(null, { status: 405, headers: { allow: 'POST' } })
  const text = await readLimitedBody(request, 32_768)

  if (text === null) return new Response(null, { status: 413 })

  const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(MosaicRequest), {
    onExcessProperty: 'error',
  })(text)

  if (Option.isNone(parsed)) return new Response(null, { status: 400 })

  try {
    const result = await renderMosaic(parsed.value.candidates, assets)

    if (!result) return new Response('No usable images found.', { status: 422 })

    return new Response(new Uint8Array(result.png).buffer, {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'no-store',
        'x-mosaic-revision': result.revision,
        'x-mosaic-images': String(result.recipe.images.length),
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response('Could not render mosaic.', { status: 503 })
  }
}
