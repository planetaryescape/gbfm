import { ReadingHistoryResetResponse } from '@gbfm/api/navigation'
import { Option, Schema } from 'effect'

import { parseCheckpoint } from '../features/reader/location'

type ApiRequest = (request: Request, path: string, init: RequestInit) => Promise<Response>

export const resetReadingHistory = async (request: Request, value: string, api: ApiRequest) => {
  const slug = parseCheckpoint(value)
  const failed = slug ? `/tweet/${encodeURIComponent(slug)}?reset=failed` : '/tweet/latest'

  try {
    const response = await api(request, '/api/navigation/reading-history', { method: 'DELETE' })
    const cookies = response.headers.getSetCookie()

    const result = response.ok
      ? Option.getOrNull(
          Schema.decodeUnknownOption(ReadingHistoryResetResponse)(await response.json()),
        )
      : null

    return { location: result?.reset ? '/tweet/latest' : failed, cookies }
  } catch {
    return { location: failed, cookies: [] }
  }
}
