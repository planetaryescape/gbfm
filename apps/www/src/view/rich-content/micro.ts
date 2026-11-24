import type { MicroEmbedMetadata } from '@gbfm/rich-content/schema'
import type { Html, HtmlBuilder } from 'foldkit/html'

export const microView = <Message>(
  micro: typeof MicroEmbedMetadata.Type,
  children: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
): Html => {
  const authors = micro.authors.map((author) => author.name).join(', ') || 'GBFM'

  return h.article(
    [h.Class('rich-content-micro'), h.AriaLabel(`Embedded note by ${authors}`)],
    [
      h.div(
        [h.Class('rich-content-micro-header')],
        [
          h.span([h.Class('rich-content-micro-author')], [authors]),
          h.a(
            [
              h.Href(`/tweet/${encodeURIComponent(micro.slug)}`),
              h.Class('rich-content-micro-date'),
            ],
            [micro.createdAt.slice(0, 10)],
          ),
        ],
      ),
      ...(micro.title === null ? [] : [h.h3([], [micro.title])]),
      h.div([h.Class('rich-content-micro-body')], children),
    ],
  )
}
