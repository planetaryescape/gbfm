const postKeyRoutes = [
  ['POST', /^\/api\/content\/post$/],
  ['POST', /^\/api\/content\/posts\/preview$/],
  ['GET', /^\/api\/content\/posts\/manage$/],
  ['GET', /^\/api\/content\/posts\/[^/]+\/edit$/],
  ['PATCH', /^\/api\/content\/posts\/[^/]+$/],
] as const

const authCookie =
  /(?:^|;\s*)(?:__Secure-|__Host-)?better-auth\.(?:session_token|session_data)(?:\.\d+)?=/

export const hasSessionCookie = (headers: Headers) => authCookie.test(headers.get('cookie') ?? '')

export const isPersonalKeyRequest = (headers: Headers) =>
  /gbfm_pat_/i.test(headers.get('authorization') ?? '') || headers.has('x-api-key')

export const personalKeyToken = (headers: Headers) => {
  const authorization = headers.get('authorization') ?? ''
  const match = /^Bearer (gbfm_pat_[A-Za-z0-9_-]+)$/i.exec(authorization)

  return match?.[1]
}

export const keyRequestRejection = (request: Request): Response | undefined => {
  if (!isPersonalKeyRequest(request.headers)) return undefined

  const reject = (status: number, tag: string) =>
    Response.json({ _tag: tag }, { status, headers: { 'cache-control': 'private, no-store' } })

  const authorization = request.headers.get('authorization') ?? ''

  if (authorization.length > 1024) return reject(431, 'KeyCredentialTooLarge')

  if (
    hasSessionCookie(request.headers) ||
    authorization.includes(',') ||
    request.headers.has('x-api-key')
  )
    return reject(400, 'AmbiguousCredential')
  const pathname = new URL(request.url).pathname

  if (pathname.includes('%') || pathname.includes('//')) return reject(400, 'AmbiguousCredential')

  if (!postKeyRoutes.some(([method, path]) => request.method === method && path.test(pathname)))
    return reject(403, 'KeyEndpointDenied')

  if (!personalKeyToken(request.headers)) return reject(401, 'InvalidKeyCredential')

  return undefined
}

export const privateKeyResponse = (request: Request, response: Response): Response => {
  if (
    !isPersonalKeyRequest(request.headers) &&
    !new URL(request.url).pathname.startsWith('/api/user/api-keys')
  )
    return response
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'private, no-store')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
