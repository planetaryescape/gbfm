import type { Actor } from '@gbfm/api/middleware/actor'
import { Effect } from 'effect'
import type { Definition, Image, ImageReference, Root, RootContent } from 'mdast'
import remarkDirective from 'remark-directive'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { S3Error, UnauthorizedError, ValidationError } from '@/errors'
import type { ConfigService } from '@/services/config.service'
import type { ObjectStoreClient } from '@/services/storage/object-store-client'

export interface MediaActor {
  readonly userId: string
  readonly userRole: string
  readonly credential?: Actor['credential'] | undefined
}

interface MediaFields {
  readonly url?: string | null | undefined
  readonly thumbnailUrl?: string | null | undefined
  readonly bannerImageUrl?: string | null | undefined
  readonly image?: string | null | undefined
  readonly content?: string | null | undefined
  readonly draft?: boolean | undefined
}

const urlFields = ['url', 'thumbnailUrl', 'bannerImageUrl', 'image'] as const

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkDirective)

function visit(root: Root | RootContent, fn: (node: RootContent) => void): void {
  if (root.type !== 'root') fn(root)

  if ('children' in root) for (const child of root.children) visit(child, fn)
}

/** Only image syntax is rewritten: prose, code, links and unsupported HTML stay untouched. */
function imageEdits(source: string) {
  const root = parser.parse(source)
  const definitions = new Map<string, Definition>()
  const images: Array<{ node: Image | ImageReference; url: string; title: string | null }> = []
  visit(root, (node) => {
    if (node.type === 'definition') definitions.set(node.identifier.toLowerCase(), node)
  })
  visit(root, (node) => {
    if (node.type === 'image') images.push({ node, url: node.url, title: node.title ?? null })

    if (node.type === 'imageReference') {
      const definition = definitions.get(node.identifier.toLowerCase())

      if (definition) images.push({ node, url: definition.url, title: definition.title ?? null })
    }
  })

  return images
}

export function attachedMediaUrls(data: MediaFields): Array<string> {
  return [
    ...urlFields.flatMap((field) => {
      const url = data[field]

      return url ? [url] : []
    }),
    ...imageEdits(data.content ?? '').map((image) => image.url),
  ]
}

/**
 * Preparation HEADs and authorizes private originals, but never copies bytes.
 * Call publish only after ALL content/creator/label writes succeed. A failed copy
 * leaves the committed deterministic public URL unavailable, not falsely successful.
 * Retrying an update with that URL repairs it from the matching private original.
 * Public copies are permanent: unpublishing does not revoke or delete shared media.
 */
export const makeMediaPublication = (
  config: Pick<ConfigService, 'urls' | 'buckets'>,
  store: ObjectStoreClient,
) => {
  const prefix = `${config.urls.bucketRouter.replace(/\/$/, '')}/user-content/`

  const localKey = (url: string): string | null => {
    const relativePrefix = '/user-content/'

    const key = url.startsWith(prefix)
      ? url.slice(prefix.length)
      : url.startsWith(relativePrefix)
        ? url.slice(relativePrefix.length)
        : null

    if (key === null) return null

    if (!key.startsWith('private/') && !key.startsWith('public/')) return null

    // Canonical keys only. Encoded separators, dot segments and URL suffixes
    // must not alias an owner's key or a different CDN authorization scope.
    if (
      !/^(?:private|public)\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)+$/.test(key) ||
      key.split('/').some((segment) => segment === '.' || segment === '..')
    )
      return ''

    return key
  }

  const storageFailure = () =>
    new S3Error({
      message: 'Media publication storage operation failed',
      operation: 'publish media',
    })

  const head = (key: string) =>
    Effect.tryPromise({
      try: () => store.headObject(config.buckets.userContent, key),
      catch: storageFailure,
    })

  return Effect.fn('media.preparePublication')(function* <T extends MediaFields>(
    data: T,
    actor: MediaActor | undefined,
    /** Supply only AFTER checking the actor's existing resource authority. */
    existing?: MediaFields,
  ) {
    const next = { ...existing, ...data }
    const attached = new Set(existing ? attachedMediaUrls(existing) : [])
    const replacements = new Map<string, string>()
    const copies = new Map<string, string>()
    const draft = next.draft ?? false

    for (const url of new Set(attachedMediaUrls(next))) {
      const key = localKey(url)

      if (key === null) continue // Legacy nonprivate assets are public without DB lookups.

      if (!key) return yield* new ValidationError({ message: 'Invalid canonical media URL' })
      const isPrivate = key.startsWith('private/')
      // Never trust a caller relabeling an unpublished private key as public.
      const destination = isPrivate ? `public/${key.slice('private/'.length)}` : key

      if (!isPrivate && (yield* head(key)) !== null) continue
      const source = `private/${destination.slice('public/'.length)}`
      const owner = source.split('/')[1]
      const uploader = actor?.userId.replace(/[^a-zA-Z0-9.-]/g, '_')

      const alreadyAttached =
        attached.has(url) ||
        attached.has(`${prefix}${source}`) ||
        attached.has(`/user-content/${source}`) ||
        attached.has(`${prefix}${destination}`) ||
        attached.has(`/user-content/${destination}`)

      if (
        !actor ||
        ((actor.userRole !== 'admin' || actor.credential?._tag === 'PersonalAccessKey') &&
          owner !== uploader &&
          !alreadyAttached)
      )
        return yield* new UnauthorizedError({
          message: 'Not authorized to attach private media',
        })

      if ((yield* head(source)) === null)
        return yield* new ValidationError({ message: 'Private media upload does not exist' })

      if (!isPrivate && draft)
        return yield* new ValidationError({ message: 'Public media copy does not exist' })

      if (draft) {
        replacements.set(url, `${prefix}${key}`)
        continue
      }

      replacements.set(url, `${prefix}${destination}`)
      copies.set(destination, source)
    }

    const rewritten: { -readonly [K in keyof MediaFields]?: MediaFields[K] } = {}

    for (const field of urlFields) {
      const url = next[field]

      if (url && replacements.has(url)) rewritten[field] = replacements.get(url)
    }

    if (next.content !== undefined && next.content !== null) {
      let content = next.content
      const edits = imageEdits(content).toReversed()

      for (const { node, url, title } of edits) {
        const replacement = replacements.get(url)
        const start = node.position?.start.offset
        const end = node.position?.end.offset

        if (!replacement || start === undefined || end === undefined) continue

        const alt = (node.alt ?? '')
          .replaceAll('\\', '\\\\')
          .replaceAll('[', '\\[')
          .replaceAll(']', '\\]')

        const caption = title === null ? '' : ` ${JSON.stringify(title)}`
        content = `${content.slice(0, start)}![${alt}](<${replacement}>${caption})${content.slice(end)}`
      }

      if (content !== next.content) rewritten.content = content
    }

    return {
      data: { ...data, ...rewritten },
      publish: Effect.forEach(
        [...copies],
        ([key, source]) =>
          Effect.tryPromise({
            try: async () => {
              if (await store.headObject(config.buckets.userContent, key)) return

              await store.copyObject(config.buckets.userContent, source, key)

              if (!(await store.headObject(config.buckets.userContent, key)))
                throw new Error('Public media copy was not created')
            },
            catch: storageFailure,
          }),
        { concurrency: 4, discard: true },
      ),
    }
  })
}

export type MediaPublication = ReturnType<typeof makeMediaPublication>
