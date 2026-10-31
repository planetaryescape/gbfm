import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Principal } from '../model'
import { signInHref } from '../page/auth/links'
import { iconPaths, lucide } from './icons'
import { mobilePlayer, type NowPlaying } from './mobile-player'
import { isActiveNavLink } from './nav-active'
import { wordmark } from './wordmark'

export type StationNavProps<M> = {
  readonly pathname: string
  readonly links: ReadonlyArray<readonly [string, string]>
  readonly principal: Principal | null
  readonly accountMenu: Html
  readonly interactive: boolean
  readonly menuOpen: boolean
  readonly queueResolved: boolean
  readonly nowPlaying: NowPlaying | null
  readonly minimized: boolean
  readonly togglePlay: M
  readonly openPlayer: M
  readonly openSearch: M
  readonly toggleMenu: M
  readonly expandNav: M
}

const mobileTabs = [
  ['/', 'Home', iconPaths.home],
  ['/shows', 'Shows', iconPaths.radio],
  ['/editorial', 'Editorial', iconPaths.editorial],
] as const

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const desktopLinkClass = `inline-flex h-11 shrink-0 items-center rounded-sm px-2.5 text-xs font-semibold tracking-wide no-underline transition-colors text-muted-foreground hover:bg-muted/60 hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:shadow-[inset_0_-2px_0_var(--highlight)] ${focusRing}`

const desktopIconButtonClass = `btn btn-quiet btn-icon shrink-0 ${focusRing}`

const tabClass =
  'dock-tab relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-sm border-0 bg-transparent p-0 no-underline text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:text-highlight'

const tabIconClass = 'size-[22px] shrink-0 [stroke-width:1.75]'

const playIcon = (isPlaying: boolean, className: string) =>
  lucide(isPlaying ? iconPaths.pause : iconPaths.play, `${className} fill-current`)

export const stationNav = <M>(h: HtmlBuilder<M>, props: StationNavProps<M>) => {
  const { nowPlaying } = props

  const desktop = h.div(
    [
      h.Class(
        'fixed inset-x-0 bottom-0 z-40 hidden h-12 shrink-0 items-center gap-4 border-t-2 border-foreground bg-background/95 pl-4 pr-6 backdrop-blur lg:flex',
      ),
    ],
    [
      nowPlaying
        ? h.div(
            [h.Class('absolute inset-x-0 top-0 h-[3px] bg-border/60')],
            [
              h.div(
                [
                  h.Class(
                    'h-full bg-highlight shadow-[0_0_6px_var(--highlight)] transition-[width] duration-300 ease-linear',
                  ),
                  h.Style({ width: `${nowPlaying.progress}%` }),
                ],
                [],
              ),
            ],
          )
        : h.empty,
      h.a(
        [
          h.Href('/'),
          h.AriaLabel('goosebumps.fm home'),
          h.Class(
            'group flex shrink-0 items-center text-foreground no-underline transition-colors hover:text-highlight',
          ),
        ],
        [wordmark()],
      ),
      h.nav(
        [h.AriaLabel('Primary'), h.Class('flex shrink-0 items-center gap-1')],
        props.links.map(([href, label]) =>
          h.a(
            [
              h.Key(href),
              h.Href(href),
              h.Class(desktopLinkClass),
              ...(isActiveNavLink(props.pathname, href) ? [h.AriaCurrent('page')] : []),
            ],
            [label],
          ),
        ),
      ),
      h.button(
        [
          h.Type('button'),
          h.AriaLabel('Search'),
          h.Disabled(!props.interactive),
          h.OnClick(props.openSearch),
          h.Class(
            `${desktopIconButtonClass} border-0 bg-transparent text-muted-foreground hover:text-foreground`,
          ),
        ],
        [lucide(iconPaths.search, 'h-4 w-4')],
      ),
      h.div([h.Class('min-w-0 flex-1')], []),
      h.div(
        [h.Class('flex shrink-0 items-center gap-3')],
        [
          nowPlaying
            ? h.div(
                [
                  h.Class(
                    'flex min-w-0 max-w-56 shrink items-center gap-2 border-r border-border pr-3',
                  ),
                ],
                [
                  h.button(
                    [
                      h.Type('button'),
                      h.AriaLabel(nowPlaying.isPlaying ? 'Pause' : 'Play'),
                      h.OnClick(props.togglePlay),
                      h.Class(
                        `${desktopIconButtonClass} border border-border bg-transparent text-foreground`,
                      ),
                    ],
                    [playIcon(nowPlaying.isPlaying, 'h-3.5 w-3.5')],
                  ),
                  h.button(
                    [
                      h.Type('button'),
                      h.OnClick(props.openPlayer),
                      h.Class(
                        `min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-xs font-medium text-muted-foreground no-underline transition-colors hover:text-foreground ${focusRing}`,
                      ),
                    ],
                    [nowPlaying.title],
                  ),
                ],
              )
            : h.empty,
          props.principal
            ? props.accountMenu
            : h.a(
                [
                  h.Href(signInHref(props.pathname)),
                  h.Class(
                    `inline-flex h-8 shrink-0 items-center rounded-sm px-2.5 text-xs font-semibold text-highlight no-underline transition-colors hover:bg-muted/60 ${focusRing}`,
                  ),
                ],
                ['Log in'],
              ),
        ],
      ),
    ],
  )

  const tabLabel = (label: string) =>
    h.span(
      [h.Class('max-w-full truncate px-0.5 text-[10px] font-medium leading-none tracking-tight')],
      [label],
    )

  const tabLink = (href: string, label: string, icon: string) =>
    h.a(
      [
        h.Href(href),
        h.AriaLabel(label),
        h.Class(tabClass),
        ...(isActiveNavLink(props.pathname, href) ? [h.AriaCurrent('page')] : []),
      ],
      [lucide(icon, tabIconClass), tabLabel(label)],
    )

  const minimized = props.minimized && nowPlaying !== null
  const onTabRoute = mobileTabs.some(([href]) => isActiveNavLink(props.pathname, href))

  const mobile = h.div(
    [h.Class('mobile-dock lg:hidden'), ...(minimized ? [h.DataAttribute('minimized', '')] : [])],
    [
      mobilePlayer(h, nowPlaying, props.queueResolved, props.openPlayer, props.togglePlay),
      h.nav(
        [h.AriaLabel('Primary'), h.Class('dock-platter dock-tabs')],
        [
          h.button(
            [
              h.Type('button'),
              h.AriaLabel('Show tabs'),
              h.Tabindex(minimized ? 0 : -1),
              h.AriaHidden(!minimized),
              h.OnClick(props.expandNav),
              ...(onTabRoute ? [h.DataAttribute('active', '')] : []),
              h.Class(`dock-tabs-expand ${tabClass} data-[active]:text-highlight`),
            ],
            [lucide(iconPaths.tabs, tabIconClass)],
          ),
          ...mobileTabs.map(([href, label, icon]) => tabLink(href, label, icon)),
          h.button(
            [
              h.Type('button'),
              h.AriaLabel('Search'),
              h.Disabled(!props.interactive),
              h.OnClick(props.openSearch),
              h.Class(tabClass),
            ],
            [lucide(iconPaths.search, tabIconClass), tabLabel('Search')],
          ),
          h.button(
            [
              h.Type('button'),
              h.AriaLabel('Menu'),
              h.Disabled(!props.interactive),
              h.AriaExpanded(props.menuOpen),
              h.AriaHasPopup('dialog'),
              h.AriaControls('mobile-menu'),
              h.OnClick(props.toggleMenu),
              h.Class(`${tabClass} ${props.menuOpen ? 'text-foreground' : ''}`),
            ],
            [lucide(iconPaths.menu, tabIconClass), tabLabel('Menu')],
          ),
        ],
      ),
    ],
  )

  return h.div([], [desktop, mobile])
}
