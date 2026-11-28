import type { Html } from '@effect/ui/html'

export const pageSkeleton = <Message>(h: Html.H<Message>) =>
  h.section
    .class('page max-w-2xl space-y-6')
    .attr('role', 'status')
    .attr('aria-label', 'Loading page')
    .children(
      h.span.class('sr-only').children('Loading page…'),
      h.div
        .attr('aria-hidden', 'true')
        .class('space-y-5 motion-safe:animate-pulse')
        .children(
          h.div.class('h-8 w-40 bg-muted'),
          [0, 1, 2].map((key) =>
            h.div
              .key(String(key))
              .class('flex gap-4 border border-border/60 p-4')
              .children(
                h.div.class('size-20 shrink-0 bg-muted'),
                h.div
                  .class('flex-1 space-y-3 py-1')
                  .children(
                    h.div.class('h-5 w-2/3 bg-muted'),
                    h.div.class('h-3 w-1/3 bg-muted'),
                    h.div.class('h-3 w-full bg-muted'),
                    h.div.class('h-3 w-4/5 bg-muted'),
                  ),
              ),
          ),
        ),
    )
