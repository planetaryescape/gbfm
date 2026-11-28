import type { Html } from '@effect/ui/html'
import type { RichContentDocument } from '@gbfm/rich-content/schema'

import { iconPaths, lucide } from '../../ui/icons'
import { richContentView } from '../../ui/rich-content/render'

export const ShowAbout = <M>(h: Html.H<M>, title: string, document: RichContentDocument) =>
  h.div.class('mt-5 max-w-prose').children(
    h.div
      .class(
        'text-foreground/80 [&_.rich-content>*]:my-0 [&_p]:line-clamp-2 [&_p]:text-sm [&_p]:leading-relaxed',
      )
      .children(richContentView(h, { ...document, blocks: document.blocks.slice(0, 1) })),
    h.button
      .attr('type', 'button')
      .attr('popovertarget', 'show-about-panel')
      .class(
        'mt-1 inline-flex items-center gap-0.5 rounded-sm border-0 bg-transparent p-0 text-sm text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground',
      )
      .children('Read more', lucide(h, iconPaths.chevronRight, 'h-3.5 w-3.5')),
    h.div
      .id('show-about-panel')
      .attr('popover', '')
      .attr('aria-label', `About ${title}`)
      .class(
        'fixed inset-0 m-auto h-fit max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-sm border border-border bg-background p-6 text-foreground shadow-2xl backdrop:bg-background/80 sm:p-10',
      )
      .children(
        h.div.class('mb-6 flex items-center justify-between gap-4').children(
          h.div.children(
            h.p.class('m-0 text-xs text-muted-foreground').children('About the show'),
            h.h2.class('m-0 mt-1 text-3xl font-black leading-none tracking-tight').children(title),
          ),
          h.button
            .attr('type', 'button')
            .attr('popovertarget', 'show-about-panel')
            .attr('popovertargetaction', 'hide')
            .attr('aria-label', 'Close')
            .class('h-9 w-9 rounded-sm border border-border bg-transparent')
            .children(lucide(h, iconPaths.close, 'block h-4 w-4')),
        ),
        richContentView(h, document),
      ),
  )
