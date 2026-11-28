import { handleCreatorFormAction } from '../features/creator/server'
import { apiRequest } from './api'
import { Responded } from './http-result'
import { loadIdentity } from './page-data/identity'

export const handleCreatorSave = async (request: Request): Promise<Responded> => {
  const identity = await loadIdentity(request).catch((cause: unknown) => {
    if (request.signal.aborted) throw cause

    return null
  })

  const response = identity?.principalKnown
    ? await handleCreatorFormAction(request, identity.principal, apiRequest)
    : new Response('Could not verify your session. Please try again.', {
        status: 503,
        headers: {
          'cache-control': 'private, no-store',
          'content-type': 'text/plain; charset=utf-8',
        },
      })

  const headers = new Headers(response.headers)
  const cookies = headers.getSetCookie()
  headers.delete('set-cookie')

  for (const cookie of [...(identity?.cookies ?? []), ...cookies])
    headers.append('set-cookie', cookie)

  return Responded(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  )
}
