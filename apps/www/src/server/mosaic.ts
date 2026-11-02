import { readLimitedBody } from '@gbfm/core/http/read-limited-body'
import { discoverMosaicImages } from '@gbfm/rich-content/mosaic'
import { RichContentDocument } from '@gbfm/rich-content/schema'
import { Option, Schema } from 'effect'

const Input = Schema.Struct({
  content: Schema.String.pipe(Schema.check(Schema.isMaxLength(100_000))),
})

const Preview = Schema.Struct({ richContent: RichContentDocument })

export const handleMosaicGeneration = async (
  request: Request,
  preview: (content: string) => Promise<Response>,
  render: (request: Request) => Promise<Response>,
): Promise<Response> => {
  const headers = { 'cache-control': 'no-store' }

  if (request.method !== 'POST')
    return new Response(null, { status: 405, headers: { ...headers, allow: 'POST' } })

  if (request.headers.get('origin') !== new URL(request.url).origin)
    return new Response(null, { status: 403, headers })

  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return new Response(null, { status: 415, headers })
  const text = await readLimitedBody(request, 128_000)

  if (text === null) return new Response(null, { status: 413, headers })

  const input = Schema.decodeUnknownOption(Schema.fromJsonString(Input), {
    onExcessProperty: 'error',
  })(text)

  if (Option.isNone(input)) return new Response(null, { status: 400, headers })

  try {
    const response = await preview(input.value.content)

    if (!response.ok) return new Response(null, { status: response.status, headers })
    const document = Schema.decodeUnknownOption(Preview)(await response.json())

    if (Option.isNone(document)) return new Response(null, { status: 502, headers })
    const candidates = discoverMosaicImages(document.value.richContent)

    if (!candidates.length) return new Response('No usable images found.', { status: 422, headers })

    const result = await render(
      new Request('https://social.internal/internal/mosaic', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': request.headers.get('x-request-id') ?? '',
        },
        body: JSON.stringify({ candidates }),
        signal: request.signal,
      }),
    )

    return result
  } catch {
    return new Response('Could not generate mosaic.', { status: 503, headers })
  }
}
