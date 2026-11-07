import { LINK_STATUS } from '@gbfm/core/status'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { Database } from '@/db/layer'
import { postsTable } from '@/db/post.schema'
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from '@/errors'
import { requireCreatorOrAdmin } from '@/lib/authorization'
import { CanonicalMusicIdentity } from '@/services/canonical-music-identity'
import { parseMusicSource } from '@/services/canonical-music-identity/music-source'
import { getLinksForEntityEffect } from '@/services/music-entity/link.service'

const candidateFromText = (text: string) =>
  Effect.gen(function* () {
    const sources = new Map<string, string>()

    for (const match of text.matchAll(/https?:\/\/[^\s<>"'`)\]}]+/g)) {
      const source = yield* parseMusicSource(match[0].replace(/[.,;!?]+$/, '')).pipe(
        Effect.catchTag('MusicSourceInvalid', () => Effect.succeed(null)),
      )

      if (!source || source.sourceEntityType === 'artist') continue
      const hostname = new URL(source.canonicalUrl).hostname

      if (source.platform !== 'other' || hostname === 'song.link' || hostname === 'album.link') {
        sources.set(source.sourceKey, source.canonicalUrl)
      }
    }

    if (sources.size > 1) {
      return yield* new ValidationError({
        message: 'Several music links were found. Paste the one to attach in Music URL.',
      })
    }

    return sources.values().next().value
  })

/** Resolve a saved post's music without publishing it or changing its authored content. */
export const resolvePostMusic = (
  postId: string,
  actor: { readonly userId: string; readonly userRole: string },
  url?: string,
  expectedUpdatedAt?: Date,
) =>
  Effect.gen(function* () {
    const db = yield* Database
    const identity = yield* CanonicalMusicIdentity

    const [post] = yield* Effect.tryPromise({
      try: () => db.select().from(postsTable).where(eq(postsTable.id, postId)).limit(1),
      catch: () =>
        new DatabaseError({ message: 'Could not load post', operation: 'select', table: 'posts' }),
    })

    if (!post)
      return yield* new NotFoundError({ message: 'Post not found', resource: 'post', id: postId })

    yield* requireCreatorOrAdmin('post', postId, actor.userId, actor.userRole)

    if (expectedUpdatedAt && expectedUpdatedAt.getTime() !== post.updatedAt.getTime())
      return yield* new ConflictError({
        message: 'The post changed since it was loaded. Reload and try again.',
      })

    let candidate =
      url?.trim() ||
      (yield* candidateFromText(
        [post.title, post.content, post.description].filter(Boolean).join('\n'),
      ))

    if (
      !candidate &&
      post.musicEntityId &&
      (post.musicEntityType === 'album' ||
        post.musicEntityType === 'track' ||
        post.musicEntityType === 'playlist')
    ) {
      const links = yield* getLinksForEntityEffect(
        post.musicEntityType,
        post.musicEntityId,
        LINK_STATUS.VERIFIED,
      )

      candidate = links.find((link) => link.platform === 'spotify')?.url ?? links[0]?.url
    }

    if (!candidate) {
      return yield* new ValidationError({
        message:
          'No music link found in the saved post. Paste a link in Music URL, or save your content and try again.',
      })
    }

    const resolved = yield* identity.resolveSource({
      url: candidate,
      origin: 'manual',
      artworkDelivery: 'required',
    })

    if (resolved.entityType === 'artist') {
      return yield* new ValidationError({
        message: 'Artist links cannot be attached. Choose an album, track or playlist.',
      })
    }

    // Provider work can take time. Do not replace an attachment chosen by a concurrent edit.
    yield* requireCreatorOrAdmin('post', postId, actor.userId, actor.userRole)

    const updated = yield* Effect.tryPromise({
      try: () =>
        db
          .update(postsTable)
          .set({
            musicEntityType: resolved.entityType,
            musicEntityId: resolved.entity.id,
            updatedAt: new Date(Math.max(Date.now(), post.updatedAt.getTime() + 1)),
          })
          .where(and(eq(postsTable.id, postId), eq(postsTable.updatedAt, post.updatedAt)))
          .returning({ id: postsTable.id, updatedAt: postsTable.updatedAt }),
      catch: () =>
        new DatabaseError({
          message: 'Could not attach music',
          operation: 'update',
          table: 'posts',
        }),
    })

    const attached = updated[0]

    if (!attached)
      return yield* new ConflictError({
        message: 'The post changed during resolution. Reload and try again.',
      })

    return {
      postId,
      updatedAt: attached.updatedAt.toISOString(),
      entityType: resolved.entityType,
      entityId: resolved.entity.id,
      url: candidate,
      title: resolved.entity.title,
      artistNames: resolved.entityType === 'playlist' ? [] : (resolved.entity.artistNames ?? []),
      coverImageUrl: resolved.entity.coverImageUrl,
    }
  }).pipe(Effect.withSpan('post.resolveMusic', { attributes: { postId } }))
