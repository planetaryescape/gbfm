import type { Principal } from '../../domain/principal'

export const navigationLinks: ReadonlyArray<readonly [string, string]> = [
  ['/shows', 'Radio Shows'],
  ['/collections', 'Collections'],
  ['/editorial', 'Editorial'],
  ['/tweets', 'Tweets'],
  ['/labels', 'Record Labels'],
  ['/about', 'About'],
]

export const visibleNavigationLinks = (principal: Principal | null) =>
  navigationLinks.filter(([href]) => href !== '/collections' || principal?.role === 'admin')

export const isActiveNavLink = (pathname: string, href: string) =>
  pathname === href ||
  pathname.startsWith(`${href}/`) ||
  (href === '/tweets' && pathname.startsWith('/tweet/'))

export const navigationPathname = (url: string) =>
  URL.parse(url, 'https://goosebumps.fm')?.pathname ?? '/'

export type ScrollState = {
  readonly y: number
  readonly minimized: boolean
}

export const nextScrollState = (state: ScrollState, y: number): ScrollState => {
  if (y <= 48) return { y, minimized: false }
  const delta = y - state.y

  return Math.abs(delta) < 16 ? state : { y, minimized: delta > 0 }
}

export const dragOffset = (drag: { readonly startY: number }, clientY: number) =>
  Math.max(0, clientY - drag.startY)

export const shouldDismiss = (offset: number, viewportHeight: number) =>
  offset >= Math.min(160, viewportHeight * 0.2)
