import { MicroPostRandomUnreadResponse, MicroPostSeenResponse } from '@gbfm/api/navigation'
import { Option, Schema } from 'effect'

import { parseCheckpoint } from '../features/reader/location'

type ApiRequest = (request: Request, path: string, init: RequestInit) => Promise<Response>

export const randomTweet = async (request: Request, value: string, api: ApiRequest) => {
  const slug = parseCheckpoint(value)
  const cookies: Array<string> = []

  const failed = (reason: 'unavailable' | 'exhausted') => ({
    location: slug ? `/tweet/${encodeURIComponent(slug)}?random=${reason}` : '/tweet/latest',
    cookies,
  })

  if (!slug) return failed('unavailable')

  try {
    const seen = await api(request, `/api/content/posts/micro/${encodeURIComponent(slug)}/seen`, {
      method: 'POST',
    })

    cookies.push(...seen.headers.getSetCookie())

    const recorded = seen.ok
      ? Option.getOrNull(Schema.decodeUnknownOption(MicroPostSeenResponse)(await seen.json()))
      : null

    if (!recorded?.recorded) return failed('unavailable')
    const forwarded = new Request(request.url, { headers: request.headers, signal: request.signal })

    const values = new Map(
      (request.headers.get('cookie') ?? '').split(';').map((part) => {
        const [name = '', ...rest] = part.trim().split('=')

        return [name, rest.join('=')]
      }),
    )

    for (const cookie of cookies) {
      const [pair = ''] = cookie.split(';')
      const [name = '', ...rest] = pair.split('=')
      values.set(name, rest.join('='))
    }

    forwarded.headers.set(
      'cookie',
      Array.from(values)
        .filter(([name]) => name)
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
    )

    const response = await api(
      forwarded,
      `/api/content/posts/micro/${encodeURIComponent(slug)}/random`,
      { method: 'GET' },
    )

    cookies.push(...response.headers.getSetCookie())

    if (!response.ok) return failed(response.status === 404 ? 'exhausted' : 'unavailable')

    const result = Option.getOrNull(
      Schema.decodeUnknownOption(MicroPostRandomUnreadResponse)(await response.json()),
    )

    const target = parseCheckpoint(result?.slug)

    return target
      ? { location: `/tweet/${encodeURIComponent(target)}`, cookies }
      : failed('unavailable')
  } catch {
    return failed('unavailable')
  }
}
