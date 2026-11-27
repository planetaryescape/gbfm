import type { Html } from '@effect/ui/html'

import type { ListeningPage } from '../../domain/listening'
import { buttonClass, fieldClass, ListeningAction, Submit } from './forms'

export const ImportPanel = <M>(h: Html.H<M>, page: ListeningPage, returnTo: string) =>
  h.details
    .open(page.preview !== null)
    .class('border-b border-border')
    .children(
      h.summary.class(`${buttonClass} cursor-pointer`).children('+ Add mixes'),
      h.div.class('grid gap-5 pb-6').children(
        h.form
          .attr('method', 'get')
          .attr('action', '/listening')
          .class('grid gap-3')
          .children(
            h.label.children(
              'Mix or public playlist URL',
              h.input
                .attr('type', 'url')
                .attr('name', 'import')
                .attr('required', '')
                .attr('maxlength', '2048')
                .class(fieldClass)
                .attr('placeholder', 'Paste a link from YouTube, Spotify, SoundCloud or Mixcloud'),
            ),
            Submit(h, 'Preview import'),
          ),
        h.p.children('One-time snapshots, not synced playlists. Existing saves keep their notes.'),
        h.details.children(
          h.summary.children('Paste several individual links'),
          ListeningAction(h, 'bulk-links', returnTo, [
            h.label.children(
              'One mix URL per line (up to 200)',
              h.textarea
                .attr('name', 'links')
                .attr('rows', '5')
                .attr('required', '')
                .class(fieldClass),
            ),
            Submit(h, 'Save links privately'),
          ]),
        ),
        page.preview
          ? h.div.class('grid gap-4 border-t border-border pt-5').children(
              h.h2.children(`Import preview · ${page.preview.items.length} mixes`),
              page.preview.warnings.map((warning) => h.p.children(warning)),
              ListeningAction(h, 'save-import', returnTo, [
                h.div
                  .class('grid max-h-72 gap-3 overflow-y-auto')
                  .children(
                    page.preview.items.map((item) =>
                      h.label
                        .class('flex min-h-11 items-center gap-3')
                        .children(
                          h.input
                            .attr('type', 'checkbox')
                            .attr('name', 'item')
                            .attr('value', JSON.stringify(item))
                            .attr('checked', ''),
                          h.span.children(item.title),
                        ),
                    ),
                  ),
                page.preview.items.length ? Submit(h, 'Save selected mixes privately') : null,
              ]),
            )
          : null,
      ),
    )
