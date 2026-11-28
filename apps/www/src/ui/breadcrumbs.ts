import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { iconPaths, lucide } from './icons'

export type Crumb = Readonly<{ label: string; href: string }>

const separator = <Message>(h: Html.H<Message>) =>
  lucide(h, iconPaths.chevronRight, 'h-3.5 w-3.5 shrink-0 text-muted-foreground')

export const crumbLink = <Message>(h: Html.H<Message>, crumb: Crumb) =>
  h.a
    .attr('href', crumb.href)
    .class('text-muted-foreground no-underline transition-colors hover:text-foreground')
    .children([crumb.label])

export const crumbCurrent = <Message>(h: Html.H<Message>, label: string) =>
  h.span.attr('aria-current', 'page').class('truncate text-foreground').children([label])

export const breadcrumbs = <Message>(
  h: Html.H<Message>,
  crumbs: ReadonlyArray<View.Content<Message>>,
) =>
  h.nav
    .attr('aria-label', 'Breadcrumb')
    .class('min-w-0')
    .children([
      h.ol.class('m-0 flex min-w-0 list-none items-center gap-1.5 p-0 text-sm').children(
        crumbs.map((crumb, index) =>
          h.li
            .key(String(index))
            .class(
              `m-0 flex list-none items-center gap-1.5 ${index === crumbs.length - 1 ? 'min-w-0' : 'shrink-0'}`,
            )
            .children([index > 0 ? separator(h) : null, crumb]),
        ),
      ),
    ])
