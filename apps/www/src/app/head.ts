import { Head } from '@effect/ui'
import { HtmlHead } from '@effect/ui/html'
import { renderDocumentHead, type SiteMetadata } from '@gbfm/site-metadata'
import { Schema } from 'effect'

export const siteHead = (metadata: SiteMetadata): ReadonlyArray<HtmlHead.Entry> => {
  const head = renderDocumentHead(metadata)

  return [
    HtmlHead.lang('en'),
    ...head.meta.map((entry) => {
      if ('title' in entry) return Head.title(entry.title)

      return HtmlHead.meta(entry)
    }),
    ...head.links.map((entry) => HtmlHead.link(entry)),
    ...head.scripts.map((entry) => {
      const data = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)),
      )(entry.children)

      return HtmlHead.jsonLd(data)
    }),
  ]
}
