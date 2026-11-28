import type { Html } from '@effect/ui/html'

import type { ContentItem } from '../../domain/content-item'
import type { SpotlightBanner } from '../../domain/editorial/spotlight-presentation'
import { formatDate } from '../../domain/format/date'
import { artwork } from '../../ui/artwork'
import { iconPaths, lucide } from '../../ui/icons'
import { CreatorLinks } from './cards'

export const DraftNotice = <M>(h: Html.H<M>, slug: string) =>
  h.aside
    .attr('aria-label', 'Private draft')
    .class(
      'my-6 flex flex-wrap items-center justify-between gap-4 rounded-sm border border-highlight/40 bg-highlight/10 p-4',
    )
    .children(
      h.div.children(
        h.span
          .class(
            'inline-flex w-fit rounded-sm border border-highlight/40 bg-highlight/10 px-2 py-1 text-xs font-bold uppercase tracking-wide text-foreground',
          )
          .children('Draft'),
        h.p
          .class('m-0 mt-2 text-sm text-muted-foreground')
          .children('Only you and your co-authors can read this unpublished post.'),
      ),
      h.a
        .attr('href', `/new/editorial?edit=${encodeURIComponent(slug)}`)
        .class('btn btn-sm shrink-0')
        .children('Edit draft'),
    )

export const ContentMasthead = <M>(
  h: Html.H<M>,
  item: ContentItem,
  kind: string,
  banner: SpotlightBanner | null,
) =>
  h.header
    .class(
      banner
        ? 'spotlight-masthead'
        : 'flex flex-col gap-6 pt-6 sm:flex-row sm:items-end sm:gap-8 sm:pt-8',
    )
    .children(
      banner
        ? artwork(
            h,
            banner.src,
            banner.alt,
            '(min-width: 1280px) 750px, (min-width: 1024px) calc((100vw - 64px) * 0.6153846), calc(100vw - 32px)',
            true,
            'spotlight-banner',
            { width: 2400, height: 800 },
          )
        : artwork(
            h,
            item.imageUrl,
            item.title,
            '(min-width: 1024px) 256px, (min-width: 640px) 208px, 192px',
            true,
            'w-48 shrink-0 rounded-sm shadow-2xl sm:w-52 lg:w-64',
          ),
      h.div
        .class('min-w-0 pb-1')
        .children(
          kind === 'mixes' && h.p.class('m-0 mb-2 text-sm text-muted-foreground').children('Mix'),
          kind === 'editorial' &&
            h.p.class('m-0 mb-2 text-sm text-muted-foreground').children('Editorial'),
          h.h1
            .class(
              'm-0 break-words text-[clamp(2rem,5vw,4rem)] font-black leading-[0.95] tracking-tighter text-foreground',
            )
            .children(item.title),
          h.p
            .class('mt-3 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground')
            .children(
              (item.creators?.length ?? 0) > 0 && h.span.children(CreatorLinks(h, item)),
              (item.creators?.length ?? 0) > 0 &&
                item.meta &&
                h.span.attr('aria-hidden', 'true').children('·'),
              item.meta && h.time.attr('datetime', item.meta).children(formatDate(item.meta)),
            ),
        ),
    )

const chip =
  'inline-flex h-7 items-center gap-1.5 rounded-sm bg-muted px-2.5 text-xs font-semibold text-muted-foreground no-underline hover:bg-highlight hover:text-highlight-foreground'

export const ContentMeta = <M>(h: Html.H<M>, item: ContentItem) =>
  h.div.class('mt-6 flex flex-wrap gap-2').children(
    (item.streamingLinks?.length ?? 0) > 0 &&
      h.nav
        .attr('aria-label', 'Listen on')
        .class('contents')
        .children(
          (item.streamingLinks ?? []).map((stream) =>
            h.a
              .key(stream.url)
              .attr('href', stream.url)
              .attr('target', '_blank')
              .attr('rel', 'noopener noreferrer')
              .class(chip)
              .children(stream.platform, lucide(h, iconPaths.externalLink, 'h-3 w-3')),
          ),
        ),
    (item.tags?.length ?? 0) > 0 &&
      h.nav
        .attr('aria-label', 'Tags')
        .class('contents')
        .children(
          (item.tags ?? []).map((tag) =>
            h.a
              .key(tag)
              .attr('href', `/tags/${encodeURIComponent(tag)}`)
              .class(chip)
              .children(`#${tag}`),
          ),
        ),
  )

export const EmailUpdatesInvite = <M>(h: Html.H<M>) =>
  h.aside
    .attr('aria-label', 'Email updates')
    .class(
      'mt-16 flex max-w-prose flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between',
    )
    .children(
      h.div
        .class('min-w-0')
        .children(
          h.p.class('m-0 text-sm font-semibold text-foreground').children('Email updates'),
          h.p
            .class('m-0 mt-1 text-sm text-muted-foreground')
            .children('New mixes, notable drops, and occasional news. Free, no account needed.'),
        ),
      h.a
        .attr('href', '/subscribe')
        .class(
          'inline-flex shrink-0 items-center gap-2 self-start border border-border px-3 py-2 text-sm font-semibold text-foreground no-underline hover:border-highlight hover:text-highlight sm:self-auto',
        )
        .children(lucide(h, iconPaths.mail, 'h-4 w-4'), 'Get email updates'),
    )
