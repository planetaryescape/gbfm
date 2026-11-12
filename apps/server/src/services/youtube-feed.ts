import { Effect, Predicate, Schema, Stream } from 'effect'
import * as Xml from 'effect/encoding/Xml'

const YoutubeFeed = Schema.Struct({
  name: Schema.Literal('feed'),
  entries: Schema.Array(Schema.Struct({ videoId: Schema.String, title: Schema.NonEmptyString })),
})

const fieldText = (entry: Xml.Element, name: string) => {
  const fields = entry.children.filter((child) => !Predicate.isString(child) && child.name === name)
  const [field] = fields

  return fields.length === 1 &&
    field &&
    !Predicate.isString(field) &&
    field.children.every(Predicate.isString)
    ? field.children.join('').trim()
    : undefined
}

export const parseYoutubeFeed = Effect.fnUntraced(function* (xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    return yield* Effect.fail(
      new Xml.XmlError({ kind: 'Unsupported', message: 'Feed declarations are not allowed.' }),
    )

  const [root] = yield* Stream.make(xml).pipe(
    Stream.pipeThroughChannel(Xml.decodeString()),
    Stream.pipeThroughChannel(Xml.elements(['*'])),
    Stream.runCollect,
  )

  if (!root?.children.some((child) => !Predicate.isString(child)))
    return yield* Effect.fail(
      new Xml.XmlError({ kind: 'Unsupported', message: 'Feed must contain child elements.' }),
    )

  const feed = yield* Schema.decodeUnknownEffect(YoutubeFeed)({
    name: root?.name,
    entries: root?.children.flatMap((child) =>
      !Predicate.isString(child) && child.name === 'entry'
        ? [{ videoId: fieldText(child, 'yt:videoId'), title: fieldText(child, 'title') }]
        : [],
    ),
  })

  return feed.entries
})
