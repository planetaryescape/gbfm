import { Schema } from 'effect'

export const RichContentVersion = Schema.Literal(1)

const isSafeSerializedUrl = (value: string) => {
  if (value.startsWith('/') && !value.startsWith('//')) return true

  try {
    const url = new URL(value)

    return (
      !url.username &&
      !url.password &&
      !url.port &&
      ['https:', 'http:', 'mailto:'].includes(url.protocol)
    )
  } catch {
    return false
  }
}

export const SafeUrl = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter<string>((value) => isSafeSerializedUrl(value) || 'Expected a safe URL'),
  ),
)

export type SafeUrl = string

export type RichContentInline =
  | { readonly _tag: 'Text'; readonly value: string }
  | {
      readonly _tag: 'Emphasis' | 'Strong' | 'Delete'
      readonly children: ReadonlyArray<RichContentInline>
    }
  | { readonly _tag: 'InlineCode'; readonly value: string }
  | {
      readonly _tag: 'Link'
      readonly href: SafeUrl
      readonly title: string | null
      readonly children: ReadonlyArray<RichContentInline>
    }
  | {
      readonly _tag: 'Image'
      readonly src: SafeUrl
      readonly alt: string
      readonly title: string | null
    }
  | { readonly _tag: 'Break' }

export const Inline: Schema.Codec<RichContentInline> = Schema.suspend(() =>
  Schema.TaggedUnion({
    Text: { value: Schema.String },
    Emphasis: { children: Schema.Array(Inline) },
    Strong: { children: Schema.Array(Inline) },
    Delete: { children: Schema.Array(Inline) },
    InlineCode: { value: Schema.String },
    Link: { href: SafeUrl, title: Schema.NullOr(Schema.String), children: Schema.Array(Inline) },
    Image: { src: SafeUrl, alt: Schema.String, title: Schema.NullOr(Schema.String) },
    Break: {},
  }),
)

export const MusicEntityType = Schema.Literals(['track', 'album', 'playlist'])

export const ExternalMediaProvider = Schema.Literals([
  'youtube',
  'soundcloud',
  'bandcamp',
  'spotify',
])

export const StreamLink = Schema.Struct({ platform: Schema.String, url: SafeUrl })

export const MusicSnapshot = Schema.Struct({
  entityType: MusicEntityType,
  entityId: Schema.NullOr(Schema.String),
  title: Schema.String,
  artists: Schema.Array(Schema.String),
  description: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(SafeUrl),
  canonicalUrl: SafeUrl,
  links: Schema.Array(StreamLink),
  tracks: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      artists: Schema.Array(Schema.String),
      url: Schema.NullOr(SafeUrl),
    }),
  ),
})

export const MicroEmbedMetadata = Schema.Struct({
  postId: Schema.NonEmptyString,
  slug: Schema.NonEmptyString,
  title: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  authors: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      username: Schema.NullOr(Schema.String),
      image: Schema.optionalKey(Schema.NullOr(SafeUrl)),
    }),
  ),
})

export type RichContentBlock =
  | { readonly _tag: 'Paragraph'; readonly children: ReadonlyArray<RichContentInline> }
  | {
      readonly _tag: 'Heading'
      readonly level: 1 | 2 | 3 | 4 | 5 | 6
      readonly children: ReadonlyArray<RichContentInline>
    }
  | {
      readonly _tag: 'List'
      readonly ordered: boolean
      readonly start: number | null
      readonly items: ReadonlyArray<{
        readonly checked: boolean | null
        readonly children: ReadonlyArray<RichContentBlock>
      }>
    }
  | {
      readonly _tag: 'Quote'
      readonly children: ReadonlyArray<RichContentBlock>
      readonly micro?: typeof MicroEmbedMetadata.Type
    }
  | { readonly _tag: 'Code'; readonly language: string | null; readonly value: string }
  | { readonly _tag: 'ThematicBreak' }
  | {
      readonly _tag: 'Table'
      readonly align: ReadonlyArray<'left' | 'center' | 'right' | null>
      readonly rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<RichContentInline>>>
    }
  | {
      readonly _tag: 'MusicEmbed'
      readonly music: typeof MusicSnapshot.Type
      readonly genres: ReadonlyArray<string>
      readonly blurb: string | null
      readonly showTracks: boolean
    }
  | {
      readonly _tag: 'ExternalMediaEmbed'
      readonly provider: typeof ExternalMediaProvider.Type
      readonly canonicalUrl: SafeUrl
      readonly embedUrl: SafeUrl
      readonly title: string
      readonly aspectRatio: number
    }
  | { readonly _tag: 'Tracklist'; readonly tracks: ReadonlyArray<{ readonly title: string }> }
  | { readonly _tag: 'CardGroup'; readonly children: ReadonlyArray<RichContentBlock> }
  | {
      readonly _tag: 'UnavailableEmbed'
      readonly kind: 'music' | 'media' | 'tracklist' | 'cards'
      readonly label: string
      readonly href: SafeUrl | null
    }
  | {
      readonly _tag: 'Unsupported'
      readonly source: string
      readonly reason: 'raw-html' | 'unknown-directive' | 'invalid-directive'
    }

export const Block: Schema.Codec<RichContentBlock> = Schema.suspend(() =>
  Schema.TaggedUnion({
    Paragraph: { children: Schema.Array(Inline) },
    Heading: { level: Schema.Literals([1, 2, 3, 4, 5, 6]), children: Schema.Array(Inline) },
    List: {
      ordered: Schema.Boolean,
      start: Schema.NullOr(Schema.Number),
      items: Schema.Array(
        Schema.Struct({ checked: Schema.NullOr(Schema.Boolean), children: Schema.Array(Block) }),
      ),
    },
    Quote: { children: Schema.Array(Block), micro: Schema.optionalKey(MicroEmbedMetadata) },
    Code: { language: Schema.NullOr(Schema.String), value: Schema.String },
    ThematicBreak: {},
    Table: {
      align: Schema.Array(Schema.NullOr(Schema.Literals(['left', 'center', 'right']))),
      rows: Schema.Array(Schema.Array(Schema.Array(Inline))),
    },
    MusicEmbed: {
      music: MusicSnapshot,
      genres: Schema.Array(Schema.String),
      blurb: Schema.NullOr(Schema.String),
      showTracks: Schema.Boolean,
    },
    ExternalMediaEmbed: {
      provider: ExternalMediaProvider,
      canonicalUrl: SafeUrl,
      embedUrl: SafeUrl,
      title: Schema.String,
      aspectRatio: Schema.Number,
    },
    Tracklist: { tracks: Schema.Array(Schema.Struct({ title: Schema.String })) },
    CardGroup: { children: Schema.Array(Block) },
    UnavailableEmbed: {
      kind: Schema.Literals(['music', 'media', 'tracklist', 'cards']),
      label: Schema.String,
      href: Schema.NullOr(SafeUrl),
    },
    Unsupported: {
      source: Schema.String,
      reason: Schema.Literals(['raw-html', 'unknown-directive', 'invalid-directive']),
    },
  }),
)

export const RichContentLayout = Schema.Literals(['spotlight'])

export type RichContentLayout = typeof RichContentLayout.Type

export const RichContentDocument = Schema.Struct({
  version: RichContentVersion,
  blocks: Schema.Array(Block),
  layout: Schema.optional(RichContentLayout),
})

export type RichContentDocument = typeof RichContentDocument.Type

export const RichContentDiagnostic = Schema.Struct({
  severity: Schema.Literals(['warning', 'error']),
  code: Schema.Literals([
    'unsupported-html',
    'unknown-directive',
    'invalid-directive-attribute',
    'legacy-expression-rejected',
    'embed-unavailable',
    'document-limit-exceeded',
  ]),
  message: Schema.String,
  line: Schema.NullOr(Schema.Number),
  column: Schema.NullOr(Schema.Number),
})

export type RichContentDiagnostic = typeof RichContentDiagnostic.Type

export class RichContentValidationError extends Schema.TaggedError<RichContentValidationError>()(
  'RichContentValidationError',
  { diagnostics: Schema.Array(RichContentDiagnostic) },
) {}
