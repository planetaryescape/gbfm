import { UiSchema } from '@effect/ui'
import { DialogInteraction, DialogTrigger } from '@effect/ui-kit'
import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { iconPaths, lucide } from '../../ui/icons'
import { MiniPlayer } from '../player/mini-player'
import { PlayerProvider } from '../player/provider'
import { DockMessage, TrackNavigationScroll } from './gestures'
import { isActiveNavLink } from './links'

const mobileTabs = [
  { href: '/', label: 'Home', icon: iconPaths.home },
  { href: '/shows', label: 'Shows', icon: iconPaths.radio },
  { href: '/editorial', label: 'Editorial', icon: iconPaths.editorial },
]

const tabClass =
  'dock-tab relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-sm border-0 bg-transparent p-0 no-underline text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:text-highlight'

const tabIconClass = 'block size-[22px] shrink-0 [stroke-width:1.75]'

const DockEvents = UiSchema.TaggedEnum({
  RequestedSearch: {},
  RequestedMenu: { method: DialogInteraction },
  ChangedMinimized: { minimized: Schema.Boolean },
})

export const MobileDock = Html.component({
  name: 'StationMobileDock',
  props: Schema.Struct({
    pathname: Schema.String,
    interactive: Schema.Boolean,
    menuOpen: Schema.Boolean,
    minimized: Schema.Boolean,
  }),
  model: Schema.Null,
  message: DockMessage,
  events: DockEvents,
  reads: { player: PlayerProvider },
}).make({
  init: () => null,
  update: {
    RequestedSearch: ($) => $.emit(DockEvents.RequestedSearch()),
    RequestedMenu: ($, { method }) => $.emit(DockEvents.RequestedMenu({ method })),
    RequestedExpand: ($) => $.emit(DockEvents.ChangedMinimized({ minimized: false })),
    ChangedMinimized: ($, { minimized }) => $.emit(DockEvents.ChangedMinimized({ minimized })),
  },
  view: (h) => {
    const props = h.props
    const current = h.reads.player.snapshot.queue.current
    const minimized = props.minimized && current !== null
    const onTabRoute = mobileTabs.some(({ href }) => isActiveNavLink(props.pathname, href))

    const tabLabel = (label: string) =>
      h.span
        .class('max-w-full truncate px-0.5 text-[10px] font-medium leading-none tracking-tight')
        .children(label)

    return h.div
      .class('mobile-dock lg:hidden')
      .attr('data-minimized', minimized ? '' : undefined)
      .onMount(
        TrackNavigationScroll({
          active:
            current !== null && !h.reads.player.fullscreenOpen && h.reads.player.fullscreenSettled,
          minimized,
        }),
      )
      .children(
        MiniPlayer(h, { key: 'station-mini-player' }),
        h.nav
          .attr('aria-label', 'Primary')
          .class('dock-platter dock-tabs')
          .children(
            h.button
              .attr('type', 'button')
              .attr('aria-label', 'Show tabs')
              .attr('tabindex', minimized ? '0' : '-1')
              .attr('aria-hidden', String(!minimized))
              .on('click', DockMessage.RequestedExpand())
              .attr('data-active', onTabRoute ? '' : undefined)
              .class(`dock-tabs-expand ${tabClass} data-[active]:text-highlight`)
              .children(lucide(h, iconPaths.chevronUp, tabIconClass), tabLabel('Nav')),
            mobileTabs.map(({ href, label, icon }) =>
              h.a
                .key(href)
                .attr('href', href)
                .attr('aria-label', label)
                .class(tabClass)
                .attr('aria-current', isActiveNavLink(props.pathname, href) ? 'page' : undefined)
                .children(lucide(h, icon, tabIconClass), tabLabel(label)),
            ),
            h.button
              .attr('type', 'button')
              .attr('aria-label', 'Search')
              .disabled(!props.interactive)
              .on('click', DockMessage.RequestedSearch())
              .class(tabClass)
              .children(lucide(h, iconPaths.search, tabIconClass), tabLabel('Search')),
            DialogTrigger(h, {
              props: { open: props.menuOpen, popupId: 'mobile-menu' },
              onPress: ({ method }) => DockMessage.RequestedMenu({ method }),
              element: h.button
                .id('station-menu-trigger')
                .attr('type', 'button')
                .attr('aria-label', 'Menu')
                .disabled(!props.interactive)
                .class(`${tabClass} ${props.menuOpen ? 'text-foreground' : ''}`),
            }).children(lucide(h, iconPaths.menu, tabIconClass), tabLabel('Menu')),
          ),
      )
  },
})
