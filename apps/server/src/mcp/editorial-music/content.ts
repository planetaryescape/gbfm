import type { DraftMusicTarget } from '@gbfm/core/post-music-references'
/* oxlint-disable anti-slop-effect/no-manual-tag-comparison -- The shared parser's recursive unresolved unions have no generated matchers. */
import { RichContentDiagnostic, RichContentDocument } from '@gbfm/rich-content/schema'
import {
  parseRichContent,
  type UnresolvedBlock,
  type EmbedReference,
} from '@gbfm/rich-content/source'
import { Effect, Option, Schema } from 'effect'

import { renderRichContent } from '@/lib/mdx'
import { parseMusicSource } from '@/services/canonical-music-identity/music-source'

import { EditorialToolError } from '../contracts'
import { MAX_MCP_RESPONSE_BYTES, McpWireResponse } from '../wire-response'

/** Supplied source only; no post lookup, catalogue import or provider request. */
export const EditorialSourceInput = Schema.Struct({
  content: Schema.String.check(Schema.isMaxLength(100_000)),
})

/** Parsing diagnostics and inert render document; unavailable embeds remain explicit placeholders. */
export const EditorialPreviewResult = Schema.Struct({
  richContent: RichContentDocument,
  diagnostics: Schema.Array(RichContentDiagnostic),
})

/** Mentions describe authored references, not permission to import or attach a target. */
export const MusicMentionsResult = Schema.Struct({
  mentions: Schema.Array(
    Schema.Struct({
      entityType: Schema.Literals(['album', 'track', 'playlist', 'artist', 'video', 'url']),
      entityId: Schema.NullOr(Schema.String),
      url: Schema.NullOr(Schema.String),
    }),
  ).check(Schema.isMaxLength(50)),
})

const invalid = () =>
  new EditorialToolError({
    code: 'invalid_input',
    message: 'Editorial source exceeds the supported content or reference limits.',
  })

/** Reject oversized encoded results before returning private source or before a caller commits a write. */
export const boundEditorialResult = <A>(value: A) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength > 256 * 1024
    ? Effect.fail(invalid())
    : Effect.succeed(value)

/** The admitted request's actual full success envelope must fit before any save or disclosure. */
export const boundEditorialWireResult = <A>(value: A) =>
  Effect.gen(function* () {
    const wire = yield* Effect.serviceOption(McpWireResponse)

    if (Option.isNone(wire))
      return yield* new EditorialToolError({
        code: 'unavailable',
        message: 'Editorial response budget is unavailable.',
      })

    const overflow = () =>
      new EditorialToolError({
        code: 'invalid_input',
        message: 'Editorial response exceeds the supported wire limit.',
      })

    const json = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(
      JSON.stringify(value),
    ).pipe(Effect.mapError(overflow))

    if (wire.value.successBytes(json) > MAX_MCP_RESPONSE_BYTES) return yield* overflow()

    return value
  })

const references = (blocks: ReadonlyArray<UnresolvedBlock>): ReadonlyArray<EmbedReference> =>
  blocks.flatMap((block) => {
    switch (block._tag) {
      case 'EmbedReference':
        return [block.reference]
      case 'Quote':
      case 'CardGroup':
        return references(block.children)
      case 'List':
        return block.items.flatMap((item) => references(item.children))
      default:
        return []
    }
  })

const parse = (raw: typeof EditorialSourceInput.Type) =>
  Schema.decodeUnknownEffect(EditorialSourceInput, { onExcessProperty: 'error' })(raw).pipe(
    Effect.mapError(invalid),
    Effect.flatMap((input) => {
      if (new TextEncoder().encode(input.content).byteLength > 100 * 1024)
        return Effect.fail(invalid())
      const parsed = parseRichContent(input.content)

      return parsed.diagnostics.some((item) => item.code === 'document-limit-exceeded')
        ? Effect.fail(invalid())
        : Effect.succeed({ input, parsed })
    }),
  )

/** Preserve every authored byte; reject offsets where the shared parser would not create an embed. */
export const insertMusicEmbedSource = Effect.fn('EditorialMusic.insertSource')(function* (
  content: string,
  target: DraftMusicTarget,
  offset: number,
) {
  const { parsed } = yield* parse({ content })
  const before = content.slice(0, offset)
  const after = content.slice(offset)

  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > content.length ||
    (offset !== 0 &&
      offset !== content.length &&
      !before.endsWith('\n\n') &&
      !after.startsWith('\n\n'))
  )
    return yield* invalid()
  const directive = `::music{type="${target.entityType}" id="${target.entityId}" tracks="false"}`

  const next =
    before +
    (before.length === 0 || before.endsWith('\n\n') ? '' : '\n\n') +
    directive +
    (after.length === 0 || after.startsWith('\n\n') ? '' : '\n\n') +
    after

  const inserted = yield* parse({ content: next })

  const count = (blocks: ReadonlyArray<UnresolvedBlock>) =>
    references(blocks).filter(
      (reference) =>
        reference._tag === 'MusicCatalog' &&
        reference.entityType === target.entityType &&
        reference.entityId.toLowerCase() === target.entityId.toLowerCase(),
    ).length

  if (count(inserted.parsed.document.blocks) !== count(parsed.document.blocks) + 1)
    return yield* invalid()

  return next
})

/** Parse and render with the shared inert renderer: zero provider calls, zero persistence. */
export const previewEditorialContent = Effect.fn('EditorialMusic.preview')(function* (
  raw: typeof EditorialSourceInput.Type,
) {
  const { input, parsed } = yield* parse(raw)

  return yield* boundEditorialResult({
    richContent: renderRichContent(input.content),
    diagnostics: parsed.diagnostics,
  })
})

/** Find at most 50 authored catalogue references and supported music URLs without resolving them. */
export const findMusicMentions = Effect.fn('EditorialMusic.findMentions')(function* (
  raw: typeof EditorialSourceInput.Type,
) {
  const { input, parsed } = yield* parse(raw)
  const mentions: Array<(typeof MusicMentionsResult.Type.mentions)[number]> = []
  const seen = new Set<string>()

  for (const reference of references(parsed.document.blocks)) {
    if (reference._tag !== 'MusicCatalog') continue
    const key = `${reference.entityType}:${reference.entityId.toLowerCase()}`

    if (seen.has(key)) continue
    seen.add(key)
    mentions.push({ entityType: reference.entityType, entityId: reference.entityId, url: null })
  }

  for (const match of input.content.matchAll(/https?:\/\/[^\s<>"'`)\]}]+/g)) {
    const source = yield* parseMusicSource(match[0].replace(/[.,;!?]+$/, '')).pipe(
      Effect.catchTag('MusicSourceInvalid', () => Effect.succeed(null)),
    )

    if (!source || source.platform === 'other' || seen.has(source.sourceKey)) continue
    seen.add(source.sourceKey)
    mentions.push({ entityType: source.sourceEntityType, entityId: null, url: source.canonicalUrl })

    if (mentions.length > 50) return yield* invalid()
  }

  return yield* Schema.decodeUnknownEffect(MusicMentionsResult)({ mentions }).pipe(
    Effect.mapError(invalid),
    Effect.flatMap(boundEditorialResult),
  )
})
