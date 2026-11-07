import { and, asc, eq, notInArray } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { audioVisibilityCondition, type AudioViewer } from '@/db/audio-visibility'
import { audioArtists, audioTable } from '@/db/audio.schema'
import {
  SOCIAL_LINK_PLATFORMS,
  type SocialLinkPlatform,
  userSocialLinks,
  user as userTable,
} from '@/db/auth.schema'
import { audioIdsForCreator } from '@/db/creator-membership'
import { Database } from '@/db/layer'
import { postCreators, postsTable } from '@/db/post.schema'
import { showCreators, showsTable } from '@/db/show.schema'
import { DatabaseError, getErrorMessage, NotFoundError } from '@/errors'

import { getArtistDjProfile, getArtistDjProfileMetadata } from './dj-artists'

function isSocialLinkPlatform(value: string): value is SocialLinkPlatform {
  return SOCIAL_LINK_PLATFORMS.some((platform) => platform === value)
}

export type PublicProfile = {
  id: string
  name: string
  username: string | null
  image: string | null
  bio: string | null
  socialLinks: Array<{
    platform: SocialLinkPlatform
    url: string
    position: number
  }>
  createdAt: Date
  content: {
    mixes: Array<{
      id: string
      title: string
      slug: string
      thumbnailUrl: string | null
      type: 'mix' | 'track' | 'misc'
      showId: string | null
      draft?: boolean
    }>
    shows: Array<{
      id: string
      title: string
      slug: string
      thumbnailUrl: string | null
    }>
    editorials: Array<{
      id: string
      title: string
      slug: string
      thumbnailUrl: string | null
      description: string | null
      createdAt: Date
    }>
    tweets: Array<{
      id: string
      title: string | null
      slug: string
      createdAt: Date
    }>
  }
}

/** Public identity metadata without media, social links or personalized content graphs. */
export type PublicProfileMetadata = Pick<
  PublicProfile,
  'id' | 'name' | 'username' | 'bio' | 'createdAt'
>

export interface ProfileService {
  /** Preserves user-first lookup, banned-user denial and the existing artist-DJ fallback. */
  readonly getPublicProfileMetadata: (
    username: string,
  ) => Effect.Effect<PublicProfileMetadata, DatabaseError | NotFoundError>
  readonly getPublicProfile: (
    username: string,
    viewer?: AudioViewer,
  ) => Effect.Effect<PublicProfile, DatabaseError | NotFoundError>
}

export const ProfileService = Context.Service<ProfileService>('ProfileService')

const getPublicProfileMetadata = Effect.fn('profile.getPublicMetadata')(function* (
  username: string,
) {
  const db = yield* Database

  const rows = yield* Effect.tryPromise({
    try: () =>
      db
        .select({
          id: userTable.id,
          name: userTable.name,
          username: userTable.username,
          bio: userTable.bio,
          createdAt: userTable.createdAt,
          banned: userTable.banned,
        })
        .from(userTable)
        .where(eq(userTable.username, username))
        .limit(1),
    catch: (error) =>
      new DatabaseError({
        message: `Public profile read failed: ${getErrorMessage(error)}`,
        operation: 'select',
        table: 'user',
      }),
  })

  const row = rows[0]

  if (!row) return yield* getArtistDjProfileMetadata(username)

  if (row.banned)
    return yield* new NotFoundError({
      message: 'Profile not found',
      resource: 'profile',
      id: username,
    })

  return {
    id: row.id,
    name: row.name,
    username: row.username,
    bio: row.bio,
    createdAt: row.createdAt,
  }
})

export const getPublicProfileEffect = (username: string, viewer?: AudioViewer) =>
  Effect.gen(function* () {
    const db = yield* Database

    const userRecords = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            id: userTable.id,
            name: userTable.name,
            username: userTable.username,
            image: userTable.image,
            bio: userTable.bio,
            createdAt: userTable.createdAt,
            banned: userTable.banned,
          })
          .from(userTable)
          .where(eq(userTable.username, username))
          .limit(1),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to get user: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'user',
        }),
    }).pipe(Effect.withSpan('profile.getPublic.user'))

    const foundUser = userRecords[0]

    if (!foundUser) return yield* getArtistDjProfile(username, viewer)

    if (foundUser.banned) {
      return yield* new NotFoundError({
        message: 'User not found',
        resource: 'user',
        id: username,
      })
    }

    const socialLinks = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            platform: userSocialLinks.platform,
            url: userSocialLinks.url,
            position: userSocialLinks.position,
          })
          .from(userSocialLinks)
          .where(eq(userSocialLinks.userId, foundUser.id))
          .orderBy(asc(userSocialLinks.position)),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to get user social links: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'user_social_links',
        }),
    }).pipe(Effect.withSpan('profile.getPublic.socialLinks'))

    const userMixes = yield* Effect.tryPromise({
      try: () =>
        db.query.audioTable.findMany({
          columns: {
            id: true,
            title: true,
            slug: true,
            thumbnailUrl: true,
            type: true,
            showId: true,
            draft: true,
          },
          with: {
            show: {
              columns: { thumbnailUrl: true },
            },
          },
          where: and(
            audioIdsForCreator(db, foundUser.id),
            audioVisibilityCondition(db, viewer),
            notInArray(audioTable.id, db.select({ id: audioArtists.audioId }).from(audioArtists)),
          ),
          orderBy: asc(audioTable.createdAt),
        }),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to get user mixes: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'audio',
        }),
    }).pipe(
      Effect.map((rows) =>
        rows.map(({ show, ...row }) => ({
          ...row,
          thumbnailUrl: row.thumbnailUrl ?? show?.thumbnailUrl ?? null,
        })),
      ),
      Effect.withSpan('profile.getPublic.mixes'),
    )

    const userShows = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            id: showsTable.id,
            title: showsTable.title,
            slug: showsTable.slug,
            thumbnailUrl: showsTable.thumbnailUrl,
          })
          .from(showsTable)
          .innerJoin(showCreators, eq(showsTable.id, showCreators.showId))
          .where(and(eq(showCreators.creatorId, foundUser.id), eq(showsTable.draft, false)))
          .orderBy(showsTable.createdAt),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to get user shows: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'shows',
        }),
    }).pipe(Effect.withSpan('profile.getPublic.shows'))

    const userPosts = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            id: postsTable.id,
            title: postsTable.title,
            slug: postsTable.slug,
            thumbnailUrl: postsTable.thumbnailUrl,
            description: postsTable.description,
            type: postsTable.type,
            createdAt: postsTable.createdAt,
          })
          .from(postsTable)
          .innerJoin(postCreators, eq(postsTable.id, postCreators.postId))
          .where(and(eq(postCreators.creatorId, foundUser.id), eq(postsTable.draft, false)))
          .orderBy(postsTable.createdAt),
      catch: (error) =>
        new DatabaseError({
          message: `Failed to get user posts: ${getErrorMessage(error)}`,
          operation: 'select',
          table: 'posts',
        }),
    }).pipe(Effect.withSpan('profile.getPublic.posts'))

    const editorials = userPosts
      .filter((p): p is typeof p & { title: string } => Boolean(p.type === 'post' && p.title))
      .map(({ type: _type, ...rest }) => rest)

    const tweets = userPosts
      .filter((p) => p.type === 'micro')
      .map(
        ({ type: _type, thumbnailUrl: _thumbnailUrl, description: _description, ...rest }) => rest,
      )

    return {
      id: foundUser.id,
      name: foundUser.name,
      username: foundUser.username,
      image: foundUser.image,
      bio: foundUser.bio,
      socialLinks: socialLinks.flatMap((link) =>
        isSocialLinkPlatform(link.platform)
          ? [{ platform: link.platform, url: link.url, position: link.position }]
          : [],
      ),
      createdAt: foundUser.createdAt,
      content: {
        mixes: userMixes,
        shows: userShows,
        editorials,
        tweets,
      },
    }
  })

export const ProfileServiceLayer = Layer.effect(
  ProfileService,
  Effect.gen(function* () {
    const db = yield* Database

    return {
      getPublicProfileMetadata: (username) =>
        getPublicProfileMetadata(username).pipe(Effect.provideService(Database, db)),
      getPublicProfile: (username, viewer) =>
        getPublicProfileEffect(username, viewer).pipe(
          Effect.provideService(Database, db),
          Effect.withSpan('profile.getPublic'),
        ),
    }
  }),
)
