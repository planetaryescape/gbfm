import type { Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { handleMosaicGeneration } from './mosaic'

const request = (body: Schema.Json = { content: 'Images' }, origin = 'https://goosebumps.fm') =>
  new Request('https://goosebumps.fm/actions/mosaic', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const document = `{"richContent":{"version":1,"blocks":[{"_tag":"Paragraph","children":[{"_tag":"Image","src":"https://i.scdn.co/image/a","alt":"","title":null}]}]}}`

describe('mosaic generation boundary', () => {
  test('requires a same-origin request and successful authenticated preview before rendering', async () => {
    let renders = 0
    let previews = 0

    const render = async () => {
      renders++

      return new Response('image')
    }

    const preview = async () => {
      previews++

      return new Response(null, { status: 403 })
    }

    expect(
      (await handleMosaicGeneration(request(undefined, 'https://evil.test'), preview, render))
        .status,
    ).toBe(403)
    expect(previews).toBe(0)
    expect((await handleMosaicGeneration(request(), preview, render)).status).toBe(403)
    expect(previews).toBe(1)
    expect(renders).toBe(0)
  })

  test('discovers sources from the resolved document, not caller supplied image lists', async () => {
    const response = await handleMosaicGeneration(
      request(),
      async (content) => {
        expect(content).toBe('Images')

        return new Response(document, { headers: { 'content-type': 'application/json' } })
      },
      async (input) => {
        expect(new URL(input.url).pathname).toBe('/internal/mosaic')
        expect(await input.json()).toEqual({
          candidates: [{ identity: 'https://i.scdn.co/image/a', url: 'https://i.scdn.co/image/a' }],
        })

        return new Response('png', {
          headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
        })
      },
    )

    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('png')
  })

  test('handles empty documents, invalid requests, and renderer outages without saving anything', async () => {
    const preview = async () => Response.json({ richContent: { version: 1, blocks: [] } })

    const render = async () => {
      throw new Error('unavailable')
    }

    expect((await handleMosaicGeneration(request(), preview, render)).status).toBe(422)
    expect((await handleMosaicGeneration(request({ content: 1 }), preview, render)).status).toBe(
      400,
    )
    expect(
      (await handleMosaicGeneration(request({ content: 'x'.repeat(129_000) }), preview, render))
        .status,
    ).toBe(413)
    expect(
      (
        await handleMosaicGeneration(
          request(),
          async () => new Response(document, { headers: { 'content-type': 'application/json' } }),
          render,
        )
      ).status,
    ).toBe(503)
  })
})
