import { OAuthClientId } from '@gbfm/core/editorial-mcp'
import { isRole } from '@gbfm/core/roles'
import { Match, Option, Schema } from 'effect'
import * as Server from 'foldkit/experimental/server'

import { authErrorKey, authErrorLocation, readAuthErrorCode } from '../page/auth/errors'
import { authHref, safeReturnPath } from '../page/auth/links'
import { loginOAuthQuery, providerRedirect } from '../page/connect/continuation'
import { ProviderOutcome } from '../page/connect/domain'
import { handleListeningAction } from '../page/listening/form-action'
import { readModeCookie } from '../page/tweet/navigation'
import { apiRequest } from './api'
import { randomTweet } from './tweet-random'
import { resetReadingHistory } from './tweet-reset'

export const redirect = (location: string, cookies: ReadonlyArray<string> = []) => {
  const headers = new Headers({ location, 'cache-control': 'private, no-store' })

  for (const cookie of cookies) headers.append('set-cookie', cookie)

  return Server.Responded(new Response(null, { status: 303, headers }))
}

export const handleFormAction = async (request: Request): Promise<Server.Responded> => {
  const url = new URL(request.url)

  if (request.headers.get('origin') !== url.origin)
    return Server.Responded(new Response('Forbidden', { status: 403 }))
  const form = await request.formData()

  const field = (name: string) =>
    Option.getOrElse(Schema.decodeUnknownOption(Schema.String)(form.get(name)), () => '')

  const action = url.pathname

  if (action.startsWith('/actions/listening/')) return handleListeningAction(request, form)

  if (action === '/actions/connections/revoke') {
    const clientId = Option.getOrNull(
      Schema.decodeUnknownOption(OAuthClientId)(form.get('clientId')),
    )

    if (!clientId) return redirect('/dashboard/connections?notice=failed')

    const response = await apiRequest(
      request,
      `/api/user/mcp-connections/${encodeURIComponent(clientId)}/revoke`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: url.origin },
        body: '{}',
      },
    )

    return redirect(
      `/dashboard/connections?notice=${response.ok ? 'disconnected' : 'failed'}`,
      response.headers.getSetCookie(),
    )
  }

  if (action.startsWith('/actions/admin/')) {
    const operation = action.slice('/actions/admin/'.length)
    const userId = field('userId')
    const role = field('role')

    if ((operation === 'create-user' || operation === 'set-role') && !isRole(role))
      return redirect('/dashboard/users?notice=failed')

    if (operation === 'create-user' && !field('email').trim() && !field('username').trim())
      return redirect('/dashboard/users?notice=failed')

    const payload = Match.value(operation).pipe(
      Match.when('create-user', () => {
        const username = field('username').trim()

        const body = {
          name: field('name').trim() || username || 'User',
          email: field('email').trim() || `${username}@placeholder.local`,
          password: field('password') || crypto.randomUUID(),
          role,
        }

        return username ? { ...body, data: { username } } : body
      }),
      Match.when('set-role', () => ({ userId, role })),
      Match.when('ban-user', () =>
        field('banReason') ? { userId, banReason: field('banReason') } : { userId },
      ),
      Match.whenOr('unban-user', 'remove-user', 'invite', () => ({ userId })),
      Match.orElse(() => null),
    )

    if (!payload) return Server.Responded(new Response('Not found', { status: 404 }))

    const response = await apiRequest(
      request,
      operation === 'invite' ? '/api/invite/send' : `/auth/admin/${operation}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: url.origin },
        body: JSON.stringify(payload),
      },
    )

    const returnQuery = new URLSearchParams({
      notice: response.ok ? 'done' : 'failed',
      search: url.searchParams.get('search') ?? '',
      offset: url.searchParams.get('offset') ?? '0',
    })

    return redirect(`/dashboard/users?${returnQuery}`, response.headers.getSetCookie())
  }

  if (action === '/actions/tweet-read-mode') {
    const mode = field('mode') === 'all' ? 'all' : 'unread'

    return Server.Responded(
      new Response(null, {
        status: 204,
        headers: {
          'cache-control': 'private, no-store',
          'set-cookie': `${readModeCookie}=${mode}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${url.protocol === 'https:' ? '; Secure' : ''}`,
        },
      }),
    )
  }

  if (action === '/actions/tweet-random') {
    const result = await randomTweet(request, field('slug'), apiRequest)

    return redirect(result.location, result.cookies)
  }

  if (action === '/actions/tweet-reset') {
    const result = await resetReadingHistory(request, field('slug'), apiRequest)

    return redirect(result.location, result.cookies)
  }

  if (action === '/actions/sign-out') {
    const response = await apiRequest(request, '/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: '{}',
    })

    if (!response.ok)
      return Server.Responded(
        new Response('Sign out failed. Please try again.', { status: response.status }),
      )

    return redirect('/', response.headers.getSetCookie())
  }

  const newsletterPath = Match.value(action).pipe(
    Match.when('/actions/subscribe', () => '/api/newsletter/subscribe'),
    Match.when('/actions/unsubscribe', () =>
      field('token') ? '/api/newsletter/unsubscribe' : '/api/newsletter/request-unsubscribe',
    ),
    Match.orElse(() => null),
  )

  if (newsletterPath) {
    const subscribing = action === '/actions/subscribe'

    if (subscribing && !field('cf-turnstile-response').trim())
      return Server.Responded(
        new Response(
          'Browser verification is required. Enable JavaScript and retry from the subscription page.',
          {
            status: 400,
            headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
          },
        ),
      )
    const headers = new Headers({ 'content-type': 'application/json', origin: url.origin })

    const clientIp =
      request.headers.get('cf-connecting-ip') ?? (import.meta.env.DEV ? '127.0.0.1' : null)

    // Only Cloudflare's original client header is trusted, never form fields or X-Forwarded-For.
    if (subscribing && clientIp) headers.set('cf-connecting-ip', clientIp)

    const response = await apiRequest(request, newsletterPath, {
      method: 'POST',
      headers,
      body: JSON.stringify(
        subscribing
          ? {
              email: field('email'),
              name: field('name'),
              turnstileToken: field('cf-turnstile-response'),
            }
          : field('token')
            ? { token: field('token') }
            : { email: field('email'), name: field('name') },
      ),
    })

    if (!response.ok)
      return Server.Responded(
        new Response('The request could not be completed. Please try again.', {
          status: response.status,
          headers: { 'cache-control': 'no-store' },
        }),
      )

    return redirect(
      action === '/actions/subscribe'
        ? '/subscribe?complete=1'
        : `/unsubscribe?complete=${field('token') ? 'removed' : 'requested'}`,
    )
  }

  const authPath = new Map([
    ['/auth/sign-in', '/auth/sign-in/email'],
    ['/auth/sign-up', '/auth/sign-up/email'],
    ['/auth/forgot-password', '/auth/request-password-reset'],
    ['/auth/reset-password', '/auth/reset-password'],
  ]).get(action)

  const path =
    authPath ??
    (action === '/actions/reply'
      ? `/api/content/posts/micro/${encodeURIComponent(url.searchParams.get('slug') ?? '')}/replies`
      : null)

  if (!path) return Server.Responded(new Response('Not found', { status: 404 }))

  const signup = action === '/auth/sign-up'

  const signedOAuthQuery =
    action === '/auth/sign-in' ? loginOAuthQuery(field('returnTo'), url.origin) : null

  const headers = new Headers({ 'content-type': 'application/json', origin: url.origin })

  if (signup) {
    const challenge = field('cf-turnstile-response').trim()

    if (!challenge || challenge.length > 2048)
      return Server.Responded(
        new Response('Browser verification is required. Please retry verification.', {
          status: 400,
          headers: { 'cache-control': 'no-store' },
        }),
      )
    headers.set('x-captcha-response', challenge)

    const clientIp =
      request.headers.get('cf-connecting-ip') ?? (import.meta.env.DEV ? '127.0.0.1' : null)

    if (clientIp) headers.set('cf-connecting-ip', clientIp)
  }

  const response = await apiRequest(request, path, {
    method: 'POST',
    redirect: 'manual',
    headers,
    body: JSON.stringify(
      authPath
        ? {
            email: field('email'),
            password: field('password'),
            name: field('name'),
            token: field('token'),
            newPassword: field('password'),
            redirectTo: `${url.origin}/auth/reset-password`,
            oauth_query: signedOAuthQuery ?? undefined,
          }
        : { content: field('content') },
    ),
  })

  if (signup && [403, 429, 503].includes(response.status))
    return Server.Responded(
      new Response('Account creation could not be completed. Please retry verification.', {
        status: response.status,
        headers: { 'cache-control': 'no-store' },
      }),
    )

  if (signedOAuthQuery && response.ok) {
    return ProviderOutcome.match(await providerRedirect(response, url.origin, signedOAuthQuery), {
      Redirect: ({ location, cookies }) => redirect(location, cookies),
      Rejected: ({ status }) =>
        Server.Responded(
          new Response('Connection failed. Start again from your app.', {
            status,
            headers: { 'cache-control': 'no-store' },
          }),
        ),
    })
  }

  if (!response.ok && authPath)
    return redirect(
      authErrorLocation(action, authErrorKey(response.status, await readAuthErrorCode(response)), {
        returnTo: field('returnTo'),
        token: field('token'),
        email: field('email'),
        name: field('name'),
      }),
    )

  if (!response.ok)
    return Server.Responded(
      new Response('The request could not be completed. Check your details and try again.', {
        status: response.status,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      }),
    )

  const returnPath = safeReturnPath(field('returnTo'), url.origin)

  return redirect(
    Match.value(action).pipe(
      Match.when('/auth/forgot-password', () =>
        authHref('/auth/forgot-password', { sent: '1', returnTo: field('returnTo') }),
      ),
      Match.when('/auth/reset-password', () => '/auth/sign-in?reset=1'),
      Match.orElse(() =>
        authPath ? returnPath : `/tweet/${encodeURIComponent(url.searchParams.get('slug') ?? '')}`,
      ),
    ),
    response.headers.getSetCookie(),
  )
}
