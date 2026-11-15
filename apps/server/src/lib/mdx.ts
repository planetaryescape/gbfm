/* oxlint-disable anti-slop-effect/no-manual-tagged-construction, anti-slop-effect/no-manual-tag-comparison -- Rich-content nodes are Schema-owned recursive unions without generated constructors or matchers. */
import { directMediaEmbed } from '@gbfm/rich-content/media'
import type { RichContentBlock, RichContentDocument, SafeUrl } from '@gbfm/rich-content/schema'
import {
  parseRichContent,
  type EmbedReference,
  type UnresolvedBlock,
  type UnresolvedDocument,
} from '@gbfm/rich-content/source'
import { Cache, Context, Data, Duration, Effect, Exit, Layer } from 'effect'

import { ValidationError } from '@/errors'
import { makeExternalMediaResolver, type ExternalMediaResolver } from '@/lib/external-media'
import {
  RichContentMusicResolver,
  type RichContentMusicResolver as RichContentMusicResolverService,
} from '@/services/rich-content-music.service'

// ── Error ─────────────────────────────────────────────────────────────────────

export class MDXCompileError extends Data.TaggedError('MDXCompileError')<{
  readonly message: string
  readonly details?: string
}> {}

// ── Service ───────────────────────────────────────────────────────────────────

export interface MdxService {
  readonly compile: (content: string) => Effect.Effect<string, MDXCompileError>
  readonly render: (content: string) => Effect.Effect<RichContentDocument>
  readonly invalidateAll: Effect.Effect<void>
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const makeLookup =
  (fn: (content: string) => Promise<string>) =>
  (content: string): Effect.Effect<string, MDXCompileError> =>
    Effect.tryPromise({
      try: () => fn(content),
      catch: (error) =>
        new MDXCompileError({
          message: 'Failed to compile MDX content',
          details: error instanceof Error ? error.message : String(error),
        }),
    })

const ttl = (exit: Exit.Exit<string, MDXCompileError>) =>
  Exit.isSuccess(exit) ? Duration.hours(1) : Duration.zero

const defaultFn = (_content: string): Promise<string> => Promise.resolve('')

const unavailableMusicResolver: RichContentMusicResolverService = {
  resolve: () => Effect.succeed(null),
  resolveMany: (references) => Effect.succeed(references.map(() => null)),
}

const directMediaResolver: ExternalMediaResolver = {
  resolve: (url) => Effect.succeed(directMediaEmbed(url)),
}

interface Resolvers {
  readonly music: RichContentMusicResolverService
  readonly media: ExternalMediaResolver
}

const hasUnavailableMedia = (blocks: ReadonlyArray<RichContentBlock>): boolean =>
  blocks.some((block) => {
    if (block._tag === 'UnavailableEmbed') return block.kind === 'media'

    if (block._tag === 'Quote' || block._tag === 'CardGroup')
      return hasUnavailableMedia(block.children)

    if (block._tag === 'List') return block.items.some((item) => hasUnavailableMedia(item.children))

    return false
  })

const makeService = (
  fn: (content: string) => Promise<string>,
  resolvers: Resolvers,
): Effect.Effect<MdxService> =>
  Effect.gen(function* () {
    const compiledCache = yield* Cache.makeWith(makeLookup(fn), {
      capacity: 256,
      timeToLive: ttl,
    })

    const renderCache = yield* Cache.makeWith(
      (content: string) => resolveDocument(parseRichContent(content).document, resolvers),
      {
        capacity: 256,
        // A provider lookup that failed is retried soon instead of pinning the fallback for an hour.
        timeToLive: (exit) =>
          Exit.isSuccess(exit) && hasUnavailableMedia(exit.value.blocks)
            ? Duration.minutes(5)
            : Duration.hours(1),
      },
    )

    return MdxService.of({
      compile: (content) =>
        Cache.get(compiledCache, content).pipe(
          Effect.withSpan('mdx.compile', {
            attributes: { 'mdx.contentLength': content.length },
          }),
        ),
      render: (content) =>
        Cache.get(renderCache, content).pipe(Effect.withSpan('richContent.render')),
      invalidateAll: Cache.invalidateAll(compiledCache).pipe(
        Effect.andThen(Cache.invalidateAll(renderCache)),
      ),
    })
  })

export const MdxService = Context.Service<MdxService>('MdxService')

// ── Live layer ────────────────────────────────────────────────────────────────

export const MdxServiceLayer: Layer.Layer<MdxService> = Layer.effect(
  MdxService,
  makeService(defaultFn, { music: unavailableMusicResolver, media: directMediaResolver }),
)

export const MdxServiceCatalogLayer: Layer.Layer<MdxService, never, RichContentMusicResolver> =
  Layer.effect(
    MdxService,
    Effect.gen(function* () {
      const music = yield* RichContentMusicResolver
      const media = yield* makeExternalMediaResolver

      return yield* makeService(defaultFn, { music, media })
    }),
  )

// ── Test factory ──────────────────────────────────────────────────────────────

export const makeMdxServiceTest = (
  fn: (content: string) => Promise<string>,
  media: ExternalMediaResolver = directMediaResolver,
): Layer.Layer<MdxService> =>
  Layer.effect(MdxService, makeService(fn, { music: unavailableMusicResolver, media }))

// ── Backward-compat shim (for show, label, release, resolve services) ─────────

export interface MDXCompilationResult {
  compiled: string
  richContent: RichContentDocument
}

export interface MDXError {
  error: string
  details?: string | undefined
}

export function isMDXCompilationResult(
  result: MDXCompilationResult | MDXError,
): result is MDXCompilationResult {
  return !('error' in result)
}

// Module-level cache shared by services that haven't migrated to MdxService
const shimCache: Cache.Cache<string, string, MDXCompileError> = Effect.runSync(
  Cache.makeWith(makeLookup(defaultFn), { capacity: 256, timeToLive: ttl }),
)

export async function compileMDX(mdxContent: string): Promise<MDXCompilationResult | MDXError> {
  return Effect.runPromise(
    Cache.get(shimCache, mdxContent).pipe(
      Effect.map((compiled): MDXCompilationResult => ({
        compiled,
        richContent: renderRichContent(mdxContent),
      })),
      Effect.catchTag('MDXCompileError', (e) =>
        Effect.succeed<MDXError>({ error: e.message, details: e.details }),
      ),
    ),
  )
}

const unavailable = (
  kind: Extract<RichContentBlock, { _tag: 'UnavailableEmbed' }>['kind'],
  label: string,
  href: SafeUrl | null,
): RichContentBlock => ({ _tag: 'UnavailableEmbed', kind, label, href })

type MusicReference = Extract<EmbedReference, { readonly _tag: 'MusicUrl' | 'MusicCatalog' }>

const musicEmbed = (
  reference: MusicReference,
  music: Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>['music'] | null,
): RichContentBlock => {
  if (music === null)
    return unavailable(
      'music',
      'This music embed is unavailable.',
      reference._tag === 'MusicUrl' ? reference.url : null,
    )

  return {
    _tag: 'MusicEmbed',
    music,
    genres: reference._tag === 'MusicUrl' ? reference.genres : [],
    blurb: reference._tag === 'MusicUrl' ? reference.blurb : null,
    showTracks: reference.showTracks,
  }
}

const resolveBlock = (
  block: UnresolvedBlock,
  resolvers: Resolvers,
): Effect.Effect<RichContentBlock> => {
  if (block._tag === 'EmbedReference') {
    if (block.reference._tag === 'ExternalMedia') {
      const url = block.reference.url

      return resolvers.media
        .resolve(url)
        .pipe(
          Effect.map(
            (embed) => embed ?? unavailable('media', 'This player could not be loaded.', url),
          ),
        )
    }

    const reference = block.reference

    return resolvers.music
      .resolve(reference)
      .pipe(Effect.map((music) => musicEmbed(reference, music)))
  }

  if (block._tag === 'Quote' || block._tag === 'CardGroup')
    return Effect.all(
      block.children.map((child) => resolveBlock(child, resolvers)),
      { concurrency: 8 },
    ).pipe(Effect.map((children) => ({ ...block, children })))

  if (block._tag === 'List')
    return Effect.all(
      block.items.map((item) =>
        Effect.all(
          item.children.map((child) => resolveBlock(child, resolvers)),
          { concurrency: 8 },
        ).pipe(Effect.map((children) => ({ ...item, children }))),
      ),
      { concurrency: 8 },
    ).pipe(Effect.map((items) => ({ ...block, items })))

  return Effect.succeed(block)
}

const resolveDocument = (
  document: UnresolvedDocument,
  resolvers: Resolvers,
): Effect.Effect<RichContentDocument> =>
  Effect.gen(function* () {
    const references: Array<MusicReference> = []

    const collect = (blocks: ReadonlyArray<UnresolvedBlock>): void => {
      for (const block of blocks) {
        if (block._tag === 'EmbedReference' && block.reference._tag !== 'ExternalMedia')
          references.push(block.reference)

        if (block._tag === 'Quote' || block._tag === 'CardGroup') collect(block.children)

        if (block._tag === 'List') for (const item of block.items) collect(item.children)
      }
    }

    collect(document.blocks)

    const snapshots = yield* Effect.cached(
      resolvers.music
        .resolveMany(references)
        .pipe(
          Effect.map(
            (values) =>
              new Map(references.map((reference, index) => [reference, values[index] ?? null])),
          ),
        ),
    )

    const hydrated: Resolvers = {
      ...resolvers,
      music: {
        ...resolvers.music,
        resolve: (reference) =>
          snapshots.pipe(Effect.map((values) => values.get(reference) ?? null)),
      },
    }

    const blocks = yield* Effect.all(
      document.blocks.map((block) => resolveBlock(block, hydrated)),
      { concurrency: 8 },
    )

    return { version: 1 as const, blocks }
  })

export const renderRichContent = (source: string): RichContentDocument =>
  Effect.runSync(
    resolveDocument(parseRichContent(source).document, {
      music: unavailableMusicResolver,
      media: directMediaResolver,
    }),
  )

export const validateCanonicalContent = (
  source: string | null | undefined,
): Effect.Effect<void, ValidationError> => {
  if (!source) return Effect.void
  const diagnostics = parseRichContent(source).diagnostics

  return diagnostics.length === 0
    ? Effect.void
    : Effect.fail(
        new ValidationError({
          message: diagnostics.map((item) => item.message).join('; '),
        }),
      )
}
