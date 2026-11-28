export const authHref = (path: string, params: Readonly<Record<string, string>>): string => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== ''))

  return query.size === 0 ? path : `${path}?${query}`
}

export const defaultReturnPath = '/dashboard'

const isAuthPath = (pathname: string) => pathname === '/auth' || pathname.startsWith('/auth/')

export const signInHref = (pathname: string): string =>
  isAuthPath(pathname) ? '/auth/sign-in' : authHref('/auth/sign-in', { returnTo: pathname })

export const safeReturnPath = (raw: string, origin: string): string => {
  const target = URL.parse(raw || defaultReturnPath, origin)

  return target?.origin === origin && !isAuthPath(target.pathname)
    ? `${target.pathname}${target.search}`
    : defaultReturnPath
}
