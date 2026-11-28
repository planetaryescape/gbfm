import { GetFavoritesResponse } from '@gbfm/api/favorites'
import { ShowSubscriptionStatusResponse } from '@gbfm/api/shows'
import { Schema } from 'effect'

import { Principal } from '../../domain/principal'
import type { PublicActionDocument } from '../../domain/public-action'
import { apiRequest } from '../api'
import { json, record, text } from './shared'

export const loadIdentity = async (request: Request) => {
  if (
    !request.headers.get('cookie')?.includes('session_token=') &&
    !request.headers.has('authorization')
  )
    return { principal: null, principalKnown: true, cookies: [] }
  const response = await apiRequest(request, '/auth/get-session', { method: 'GET' })
  const payload = await json(response)
  const user = response.ok ? record(record(payload)?.user) : null

  const principal = user
    ? Schema.decodeUnknownSync(Principal)({
        id: text(user.id),
        name: text(user.name) || null,
        username: text(user.username) || null,
        image: text(user.image) || null,
        role: text(user.role, 'user'),
      })
    : null

  return {
    principal,
    principalKnown: response.ok && (payload === null || user !== null),
    cookies: response.headers.getSetCookie(),
  }
}

export const loadPublicActionState = async (
  request: Request,
  target: PublicActionDocument['target'],
): Promise<PublicActionDocument['state']> => {
  if (target.kind === 'show') {
    const response = await apiRequest(
      request,
      `/api/shows/${encodeURIComponent(target.id)}/subscription`,
      { method: 'GET' },
    )

    if (!response.ok) return 'unavailable'

    const status = Schema.decodeUnknownSync(ShowSubscriptionStatusResponse)(await response.json())

    return status.subscribed ? 'active' : 'inactive'
  }

  let offset = 0

  while (true) {
    const response = await apiRequest(request, `/api/favorites?limit=100&offset=${offset}`, {
      method: 'GET',
    })

    if (!response.ok) return 'unavailable'

    const result = Schema.decodeUnknownSync(GetFavoritesResponse)(await response.json())

    if (result.favorites.some((favorite) => favorite.audioId === target.id)) return 'active'
    offset += result.favorites.length

    if (!result.favorites.length || offset >= result.total) return 'inactive'
  }
}
