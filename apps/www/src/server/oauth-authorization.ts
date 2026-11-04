import { oauthQuery, providerRedirect } from '../page/connect/continuation'
import { ProviderOutcome } from '../page/connect/domain'
import { apiRequest } from './api'

const browserNavigation = (request: Request) => {
  const mode = request.headers.get('sec-fetch-mode')

  return (
    mode === 'navigate' ||
    (!mode && /(?:text\/html|application\/xhtml\+xml)/i.test(request.headers.get('accept') ?? ''))
  )
}

const validDestination = (location: string, requestUrl: URL) => {
  const target = URL.parse(location, requestUrl.origin)

  if (!target) return false

  if (
    target.origin === requestUrl.origin &&
    ['/connect/gbfm', '/connect/gbfm/consent'].includes(target.pathname)
  )
    return oauthQuery(target.searchParams) !== null

  const callback = URL.parse(requestUrl.searchParams.get('redirect_uri') ?? '')

  return (
    callback !== null &&
    target.protocol === callback.protocol &&
    target.host === callback.host &&
    target.pathname === callback.pathname &&
    !target.username &&
    !target.password
  )
}

export const forwardOAuthAuthorization = async (
  request: Request,
  forward: typeof apiRequest = apiRequest,
): Promise<Response> => {
  const url = new URL(request.url)

  const response = await forward(
    new Request(request, { redirect: 'manual' }),
    `${url.pathname}${url.search}`,
  )

  if (
    request.method !== 'GET' ||
    url.pathname !== '/auth/oauth2/authorize' ||
    !browserNavigation(request) ||
    !response.ok ||
    !response.headers.get('content-type')?.includes('application/json')
  )
    return response

  return ProviderOutcome.match(
    await providerRedirect(response.clone(), url.origin, url.searchParams.toString()),
    {
      Rejected: ({ status }) =>
        new Response('The authorization continuation could not be completed.', {
          status,
          headers: { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' },
        }),
      Redirect: ({ location, cookies }) => {
        if (!validDestination(location, url))
          return new Response('The authorization continuation could not be completed.', {
            status: 502,
            headers: { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' },
          })

        const headers = new Headers({
          location,
          'cache-control': 'private, no-store',
          'referrer-policy': 'no-referrer',
        })

        for (const cookie of cookies) headers.append('set-cookie', cookie)

        return new Response(null, { status: 303, headers })
      },
    },
  )
}
