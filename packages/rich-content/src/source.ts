/* oxlint-disable anti-slop-effect/no-manual-tagged-construction, anti-slop-effect/no-manual-tag-comparison, anti-slop-effect/prefer-effect-match -- This projector also constructs an unresolved parser-only union that has no Schema constructors. */
import { Effect } from 'effect'
import type { Root } from 'mdast'
import remarkDirective from 'remark-directive'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { RICH_CONTENT_LIMITS } from './limits.ts'
import { mediaReference } from './media.ts'
import {
  RichContentValidationError,
  SafeUrl,
  type RichContentBlock,
  type RichContentDiagnostic,
  type RichContentInline,
} from './schema.ts'

export type UrlPurpose = 'link' | 'image' | 'media'

export class UnsafeUrlError {
  readonly _tag = 'UnsafeUrlError'
}

const safe = (value: string) => SafeUrl.make(value)

const siteRelative = (value: string) => value.startsWith('/') && !value.startsWith('//')

export const safeUrl = (value: string, purpose: UrlPurpose): SafeUrl | null => {
  if (siteRelative(value)) return safe(value)
  let url: URL

  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (url.username || url.password || url.port) return null

  if (purpose === 'link' && url.protocol === 'mailto:') return safe(url.href)

  if (url.protocol !== 'https:' && !(purpose === 'link' && url.protocol === 'http:')) return null

  if (purpose !== 'media') return safe(url.href)

  return mediaReference(url) ? safe(url.href) : null
}

export const parseSafeUrl = (value: string, purpose: UrlPurpose) => {
  const parsed = safeUrl(value, purpose)

  return parsed ? Effect.succeed(parsed) : Effect.fail(new UnsafeUrlError())
}

export type EmbedReference =
  | {
      readonly _tag: 'MusicUrl'
      readonly entityType: 'track' | 'album' | 'playlist'
      readonly url: SafeUrl
      readonly genres: ReadonlyArray<string>
      readonly blurb: string | null
      readonly showTracks: boolean
    }
  | {
      readonly _tag: 'MusicCatalog'
      readonly entityType: 'track' | 'album' | 'playlist'
      readonly entityId: string
      readonly showTracks: boolean
    }
  | { readonly _tag: 'ExternalMedia'; readonly url: SafeUrl }

export type UnresolvedBlock =
  | Exclude<
      RichContentBlock,
      {
        readonly _tag:
          | 'MusicEmbed'
          | 'ExternalMediaEmbed'
          | 'UnavailableEmbed'
          | 'CardGroup'
          | 'List'
          | 'Quote'
      }
    >
  | { readonly _tag: 'EmbedReference'; readonly reference: EmbedReference }
  | { readonly _tag: 'CardGroup'; readonly children: ReadonlyArray<UnresolvedBlock> }
  | { readonly _tag: 'Quote'; readonly children: ReadonlyArray<UnresolvedBlock> }
  | {
      readonly _tag: 'List'
      readonly ordered: boolean
      readonly start: number | null
      readonly items: ReadonlyArray<{
        readonly checked: boolean | null
        readonly children: ReadonlyArray<UnresolvedBlock>
      }>
    }

export interface UnresolvedDocument {
  readonly version: 1
  readonly blocks: ReadonlyArray<UnresolvedBlock>
}

export interface ParseRichContentResult {
  readonly document: UnresolvedDocument
  readonly diagnostics: ReadonlyArray<RichContentDiagnostic>
}

export interface ParseRichContentOptions {
  readonly sourceBytes?: number
  readonly blocks?: number
  /** Anonymous source-prose projection only; existing browser parsing is unchanged. */
  readonly publicSourceProse?: boolean
}

interface DocumentTotals {
  readonly blocks: number
  readonly embeds: number
}

type Node = {
  type: string
  value?: string
  depth?: number
  ordered?: boolean
  start?: number | null
  checked?: boolean | null
  lang?: string | null
  url?: string
  title?: string | null
  alt?: string
  align?: Array<'left' | 'center' | 'right' | null>
  name?: string
  attributes?: Record<string, string | null>
  identifier?: string
  children?: Array<Node>
  position?: {
    start: { line: number; column: number; offset?: number }
    end: { line: number; column: number; offset?: number }
  }
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkDirective)

// Keep provenance until unsupported inline nodes have been removed. Sanitizing
// resulting Text strings would also destroy deliberately authored prose/code.
const publicSourceNodes = (nodes: Array<Node>): Array<Node> => {
  const definitions = new Map<string, Node>()

  const collect = (items: Array<Node>): void => {
    for (const node of items) {
      if (node.type === 'definition' && node.identifier) {
        const key = node.identifier.toUpperCase()

        if (!definitions.has(key)) definitions.set(key, node)
      }

      if (node.children) collect(node.children)
    }
  }

  collect(nodes)

  const project = (items: Array<Node>): Array<Node> =>
    items.flatMap((node): Array<Node> => {
      if (node.type === 'definition') return []

      if (node.type === 'html' || node.type === 'textDirective')
        return [{ type: 'text', value: '[Unsupported markup omitted]' }]
      const projected: Node = { ...node }

      if (node.children) projected.children = project(node.children)

      if (node.type === 'linkReference' || node.type === 'imageReference') {
        const definition = definitions.get((node.identifier ?? '').toUpperCase())
        projected.type = node.type === 'linkReference' ? 'link' : 'image'

        if (definition?.url !== undefined) projected.url = definition.url

        if (definition?.title !== undefined) projected.title = definition.title
      }

      return [projected]
    })

  return project(nodes)
}

const location = (node: Node) => ({
  line: node.position?.start.line ?? null,
  column: node.position?.start.column ?? null,
})

const diagnostic = (
  node: Node,
  severity: 'warning' | 'error',
  code: RichContentDiagnostic['code'],
  message: string,
): RichContentDiagnostic => ({ severity, code, message, ...location(node) })

const sourceOf = (node: Node, source: string) => {
  const start = node.position?.start.offset
  const end = node.position?.end.offset

  return start === undefined || end === undefined ? '' : source.slice(start, end)
}

const inlines = (
  nodes: Array<Node>,
  diagnostics: Array<RichContentDiagnostic>,
): Array<RichContentInline> =>
  nodes.flatMap((node) => {
    if (node.type === 'text') return [{ _tag: 'Text', value: node.value ?? '' }]

    if (node.type === 'inlineCode') return [{ _tag: 'InlineCode', value: node.value ?? '' }]

    if (node.type === 'break') return [{ _tag: 'Break' }]

    if (node.type === 'emphasis' || node.type === 'strong' || node.type === 'delete')
      return [
        {
          _tag:
            node.type === 'emphasis' ? 'Emphasis' : node.type === 'strong' ? 'Strong' : 'Delete',
          children: inlines(node.children ?? [], diagnostics),
        },
      ]

    if (node.type === 'link') {
      const href = safeUrl(node.url ?? '', 'link')

      if (href)
        return [
          {
            _tag: 'Link',
            href,
            title: node.title ?? null,
            children: inlines(node.children ?? [], diagnostics),
          },
        ]

      if (!node.url) return inlines(node.children ?? [], diagnostics)

      diagnostics.push(
        diagnostic(
          node,
          'warning',
          'invalid-directive-attribute',
          'Unsafe link URL was rendered as text',
        ),
      )

      return inlines(node.children ?? [], diagnostics)
    }

    if (node.type === 'image') {
      const src = safeUrl(node.url ?? '', 'image')

      if (src) return [{ _tag: 'Image', src, alt: node.alt ?? '', title: node.title ?? null }]
      diagnostics.push(
        diagnostic(
          node,
          'warning',
          'invalid-directive-attribute',
          'Unsafe image URL was rendered as alt text',
        ),
      )

      return [{ _tag: 'Text', value: node.alt ?? '' }]
    }

    return [{ _tag: 'Text', value: node.value ?? '' }]
  })

const genres = (value?: string | null) => [
  ...new Set(
    (value ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  ),
]

const musicEntityType = (value: string | null | undefined) => {
  if (value === 'track' || value === 'album' || value === 'playlist') return value

  return null
}

const headingLevel = (value: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 => {
  if (value === 2 || value === 3 || value === 4 || value === 5 || value === 6) return value

  return 1
}

const attrsValid = (attrs: Record<string, string | null>, allowed: ReadonlyArray<string>) =>
  Object.keys(attrs).every((key) => allowed.includes(key)) &&
  Object.values(attrs).every(
    (value) => (value?.length ?? 0) <= RICH_CONTENT_LIMITS.directiveAttributeCharacters,
  )

const directive = (
  node: Node,
  source: string,
  diagnostics: Array<RichContentDiagnostic>,
): UnresolvedBlock => {
  const name = node.name ?? ''
  const attrs = node.attributes ?? {}

  const invalid = (message: string): UnresolvedBlock => {
    diagnostics.push(diagnostic(node, 'warning', 'invalid-directive-attribute', message))

    return { _tag: 'Unsupported', source: sourceOf(node, source), reason: 'invalid-directive' }
  }

  if (name === 'track' || name === 'album' || name === 'playlist') {
    if (
      !attrsValid(attrs, ['url', 'id', 'genres', 'blurb', 'tracks']) ||
      Number(attrs.url !== undefined) + Number(attrs.id !== undefined) !== 1 ||
      (attrs.tracks !== undefined && attrs.tracks !== 'true' && attrs.tracks !== 'false')
    )
      return invalid(`Invalid ${name} directive`)
    const showTracks = attrs.tracks !== 'false'

    if (attrs.id)
      return {
        _tag: 'EmbedReference',
        reference: { _tag: 'MusicCatalog', entityType: name, entityId: attrs.id, showTracks },
      }
    const url = safeUrl(attrs.url ?? '', 'media')
    const parsed = url ? mediaReference(new URL(url)) : null

    if (!url || parsed?.provider !== 'spotify' || parsed.musicType !== name)
      return invalid(`Invalid ${name} URL`)

    return {
      _tag: 'EmbedReference',
      reference: {
        _tag: 'MusicUrl',
        entityType: name,
        url,
        genres: genres(attrs.genres),
        blurb: attrs.blurb ?? null,
        showTracks,
      },
    }
  }

  if (name === 'music') {
    const entityType = musicEntityType(attrs.type)

    if (
      !attrsValid(attrs, ['type', 'id', 'tracks']) ||
      !attrs.id ||
      !entityType ||
      (attrs.tracks !== undefined && attrs.tracks !== 'true' && attrs.tracks !== 'false')
    )
      return invalid('Invalid music directive')

    return {
      _tag: 'EmbedReference',
      reference: {
        _tag: 'MusicCatalog',
        entityType,
        entityId: attrs.id,
        showTracks: attrs.tracks !== 'false',
      },
    }
  }

  if (name === 'media') {
    if (!attrsValid(attrs, ['url']) || !attrs.url) return invalid('Invalid media directive')
    const url = safeUrl(attrs.url, 'media')

    if (!url) return invalid('Invalid media URL')

    return { _tag: 'EmbedReference', reference: { _tag: 'ExternalMedia', url } }
  }

  if (name === 'tracklist' && node.type === 'containerDirective') {
    if (
      !attrsValid(attrs, []) ||
      (node.children ?? []).length !== 1 ||
      node.children?.[0]?.type !== 'list'
    )
      return invalid('Tracklist must contain one list')
    const list = node.children[0]

    const tracks = (list.children ?? [])
      .map((item) => ({ title: plainText(item).trim() }))
      .filter((item) => item.title.length > 0)

    if (tracks.length > RICH_CONTENT_LIMITS.tracklistEntries)
      return invalid('Tracklist limit exceeded')

    return { _tag: 'Tracklist', tracks }
  }

  if (name === 'cards' && node.type === 'containerDirective') {
    const children = (node.children ?? []).map((child) => directive(child, source, diagnostics))

    if (!attrsValid(attrs, []) || children.some((child) => child._tag !== 'EmbedReference'))
      return invalid('Cards may contain only embeds')

    return { _tag: 'CardGroup', children }
  }

  diagnostics.push(diagnostic(node, 'warning', 'unknown-directive', `Unknown directive: ${name}`))

  return { _tag: 'Unsupported', source: sourceOf(node, source), reason: 'unknown-directive' }
}

const plainText = (node: Node): string =>
  node.value ?? (node.children ?? []).map(plainText).join('')

const blocks = (
  nodes: Array<Node>,
  source: string,
  diagnostics: Array<RichContentDiagnostic>,
  depth = 0,
): Array<UnresolvedBlock> =>
  nodes.map((node): UnresolvedBlock => {
    if (depth > RICH_CONTENT_LIMITS.nestingDepth) {
      diagnostics.push(
        diagnostic(node, 'warning', 'document-limit-exceeded', 'Nesting depth limit exceeded'),
      )

      return { _tag: 'Unsupported', source: sourceOf(node, source), reason: 'invalid-directive' }
    }

    if (node.type === 'paragraph') {
      const children = node.children ?? []

      if (
        children.length === 1 &&
        children[0]?.type === 'link' &&
        children[0].url === plainText(children[0])
      ) {
        const url = safeUrl(children[0].url ?? '', 'media')
        const ref = url ? mediaReference(new URL(url)) : null

        if (url && ref?.provider === 'spotify' && ref.musicType)
          return {
            _tag: 'EmbedReference',
            reference: {
              _tag: 'MusicUrl',
              entityType: ref.musicType,
              url,
              genres: [],
              blurb: null,
              showTracks: true,
            },
          }

        if (url && ref) return { _tag: 'EmbedReference', reference: { _tag: 'ExternalMedia', url } }
      }

      return { _tag: 'Paragraph', children: inlines(children, diagnostics) }
    }

    if (node.type === 'heading')
      return {
        _tag: 'Heading',
        level: headingLevel(node.depth),
        children: inlines(node.children ?? [], diagnostics),
      }

    if (node.type === 'blockquote')
      return {
        _tag: 'Quote',
        children: blocks(node.children ?? [], source, diagnostics, depth + 1),
      }

    if (node.type === 'list')
      return {
        _tag: 'List',
        ordered: node.ordered ?? false,
        start: node.ordered ? (node.start ?? 1) : null,
        items: (node.children ?? []).map((item) => ({
          checked: item.checked ?? null,
          children: blocks(item.children ?? [], source, diagnostics, depth + 1),
        })),
      }

    if (node.type === 'code')
      return { _tag: 'Code', language: node.lang ?? null, value: node.value ?? '' }

    if (node.type === 'thematicBreak') return { _tag: 'ThematicBreak' }

    if (node.type === 'table')
      return {
        _tag: 'Table',
        align: node.align ?? [],
        rows: (node.children ?? [])
          .slice(0, RICH_CONTENT_LIMITS.tableRows)
          .map((row) =>
            (row.children ?? [])
              .slice(0, RICH_CONTENT_LIMITS.tableColumns)
              .map((cell) => inlines(cell.children ?? [], diagnostics)),
          ),
      }

    if (node.type === 'html') {
      diagnostics.push(diagnostic(node, 'warning', 'unsupported-html', 'Raw HTML is unsupported'))

      return { _tag: 'Unsupported', source: node.value ?? '', reason: 'raw-html' }
    }

    if (node.type.endsWith('Directive')) return directive(node, source, diagnostics)

    return { _tag: 'Unsupported', source: sourceOf(node, source), reason: 'invalid-directive' }
  })

export const parseRichContent = (
  source: string,
  options: ParseRichContentOptions = {},
): ParseRichContentResult => {
  const diagnostics: Array<RichContentDiagnostic> = []
  const sourceBytes = options.sourceBytes ?? RICH_CONTENT_LIMITS.sourceBytes
  const blockLimit = options.blocks ?? RICH_CONTENT_LIMITS.blocks

  if (new TextEncoder().encode(source).byteLength > sourceBytes)
    diagnostics.push({
      severity: 'error',
      code: 'document-limit-exceeded',
      message: 'Source size limit exceeded',
      line: null,
      column: null,
    })
  const root: Root = parser.parse(source)
  // SAFETY: unified returns mdast nodes; Node is the exact field subset read by this projector.
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion
  const nodes = root.children as Array<Node>

  const projected = blocks(
    options.publicSourceProse ? publicSourceNodes(nodes) : nodes,
    source,
    diagnostics,
  )

  const totals = projected.reduce(
    function visit(total, block): DocumentTotals {
      const current = {
        blocks: total.blocks + 1,
        embeds: total.embeds + (block._tag === 'EmbedReference' ? 1 : 0),
      }

      if (block._tag === 'Quote' || block._tag === 'CardGroup')
        return block.children.reduce(visit, current)

      if (block._tag === 'List')
        return block.items.reduce(
          (listTotal, item) => item.children.reduce(visit, listTotal),
          current,
        )

      return current
    },
    { blocks: 0, embeds: 0 },
  )

  if (totals.blocks > blockLimit)
    diagnostics.push({
      severity: 'error',
      code: 'document-limit-exceeded',
      message: 'Block limit exceeded',
      line: null,
      column: null,
    })

  if (totals.embeds > RICH_CONTENT_LIMITS.embeds)
    diagnostics.push({
      severity: 'error',
      code: 'document-limit-exceeded',
      message: 'Embed limit exceeded',
      line: null,
      column: null,
    })

  return {
    document: { version: 1, blocks: projected.slice(0, blockLimit) },
    diagnostics,
  }
}

export const validateForWrite = (
  source: string,
): Effect.Effect<void, RichContentValidationError> => {
  const result = parseRichContent(source)
  const diagnostics = result.diagnostics.map((item) => ({ ...item, severity: 'error' as const }))

  return diagnostics.length === 0
    ? Effect.void
    : Effect.fail(new RichContentValidationError({ diagnostics }))
}
