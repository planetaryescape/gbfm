import { RichContentDocument } from '@gbfm/rich-content/schema'
import { Option, Schema } from 'effect'

import { ContentItem } from '../../model'

const JsonObject = Schema.Record(Schema.String, Schema.Json)

export const record = (value: Schema.Json | undefined) =>
  Option.getOrNull(Schema.decodeUnknownOption(JsonObject)(value))

export const text = (value: Schema.Json | undefined, fallback = '') =>
  Option.getOrElse(Schema.decodeUnknownOption(Schema.String)(value), () => fallback)

export const json = async (response: Response): Promise<Schema.Json> =>
  Schema.decodeUnknownSync(Schema.Json)(await response.json())

export const contentItems = (payload: Schema.Json, path: string): ReadonlyArray<ContentItem> => {
  const container = record(payload)

  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(container?.data)
      ? container.data
      : [payload]

  return candidates.flatMap((value) => {
    const item = record(value)

    if (!item) return []
    const slug = text(item.slug, text(item.id))
    const content = text(item.content)

    const richContent = Option.getOrNull(
      Schema.decodeUnknownOption(RichContentDocument)(item.richContent),
    )

    const title = text(item.title, text(item.name, text(item.username, content.slice(0, 80))))

    if (!slug) return []

    const artists = Option.getOrUndefined(
      Schema.decodeUnknownOption(ContentItem.fields.creators)(item.artists),
    )

    return [
      {
        id: text(item.id, slug),
        slug,
        title,
        content,
        richContent,
        description: text(item.description, text(item.bio)) || null,
        imageUrl: text(item.thumbnailUrl, text(item.imageUrl, text(item.image))) || null,
        audioUrl: text(item.url) || null,
        audioType: Option.getOrNull(
          Schema.decodeUnknownOption(ContentItem.fields.audioType)(item.type),
        ),
        show: Option.getOrNull(Schema.decodeUnknownOption(ContentItem.fields.show)(item.show)),
        creators: artists?.length
          ? artists
          : Option.getOrUndefined(
              Schema.decodeUnknownOption(ContentItem.fields.creators)(item.creators),
            ),
        tags: Option.getOrNull(Schema.decodeUnknownOption(ContentItem.fields.tags)(item.tags)),
        streamingLinks: Option.getOrNull(
          Schema.decodeUnknownOption(ContentItem.fields.streamingLinks)(item.streamingLinks),
        ),
        href: `${path}/${encodeURIComponent(slug)}`,
        meta: text(item.releaseDate, text(item.createdAt)) || null,
        draft: item.draft === true,
      },
    ]
  })
}
