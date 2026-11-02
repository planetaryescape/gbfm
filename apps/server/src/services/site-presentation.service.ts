import type { SiteMetadataRouteKind } from '@gbfm/api/site-metadata'
import {
  makeAudioSiteMetadata,
  makeLabelSiteMetadata,
  makePostSiteMetadata,
  makeProfileSiteMetadata,
  makeReleaseSiteMetadata,
  makeShowSiteMetadata,
  SITE_URL,
  type SiteMetadata,
} from '@gbfm/site-metadata'
import {
  buildSocialCardPresentation,
  buildTweetCardPresentation,
  type SocialCardInput,
  type SocialCardPresentation,
} from '@gbfm/social-card'
import { Effect, Match } from 'effect'

import type { SelectMdxCompiledAudio } from '@/db/audio.schema'
import type { SelectMdxCompiledShow } from '@/db/show.schema'
import { AudioService } from '@/services/audio.service'
import { ConfigService } from '@/services/config.service'
import { MusicEntityService } from '@/services/music-entity'
import { PostService } from '@/services/post.service'
import { ProfileService, type PublicProfile } from '@/services/profile.service'
import { ReleaseService } from '@/services/release.service'
import { ResolveService } from '@/services/resolve.service'
import { ShowService } from '@/services/show.service'

/** Metadata and social-card projections derived from one resolved content value. */
export type SitePresentation = {
  readonly metadata: SiteMetadata
  readonly socialCard: SocialCardPresentation
}

const iso = (date: Date | null | undefined) => date?.toISOString() ?? null

const withGeneratedImage = (
  metadata: SiteMetadata,
  socialCard: SocialCardPresentation,
): SitePresentation => ({
  metadata: {
    ...metadata,
    image: {
      url: socialCard.images.openGraph,
      alt: metadata.image.alt,
      width: 1200,
      height: 630,
    },
  },
  socialCard,
})

const present = (metadata: SiteMetadata, input: SocialCardInput) =>
  Effect.promise(() => buildSocialCardPresentation(input)).pipe(
    Effect.map((socialCard) => withGeneratedImage(metadata, socialCard)),
  )

const presentationFromProfile = (profile: PublicProfile, slug: string, siteUrl: string) => {
  const contributionCount =
    profile.content.mixes.length +
    profile.content.shows.length +
    profile.content.editorials.length +
    profile.content.tweets.length

  const metadata = makeProfileSiteMetadata({
    slug,
    title: profile.name,
    description: profile.bio,
    imageUrl: profile.image,
    publishedAt: iso(profile.createdAt),
    contributionCount,
    siteUrl,
  })

  return present(metadata, {
    kind: 'profile',
    slug,
    title: metadata.title,
    description: metadata.description,
    detail: `${contributionCount} ${contributionCount === 1 ? 'contribution' : 'contributions'}`,
    imageUrl: profile.image,
  })
}

export const presentationFromAudio = (
  kind: 'mix' | 'track',
  audio: SelectMdxCompiledAudio,
  siteUrl: string,
) => {
  const creators =
    (audio.artists?.length ? audio.artists : audio.creators)?.map((creator) => creator.name) ?? []

  const metadata = makeAudioSiteMetadata({
    kind,
    slug: audio.slug,
    title: audio.title,
    description: audio.description,
    imageUrl: audio.thumbnailUrl,
    creators,
    publishedAt: iso(audio.createdAt),
    modifiedAt: iso(audio.updatedAt),
    audioUrl: audio.url,
    siteUrl,
  })

  return present(metadata, {
    kind,
    slug: audio.slug,
    title: metadata.title,
    creators,
    imageUrl: audio.thumbnailUrl,
  })
}

const presentationForAudio = (kind: 'mix' | 'track', slug: string, siteUrl: string) =>
  Effect.gen(function* () {
    const service = yield* AudioService
    const audio = yield* service.getBySlug(kind, slug)

    return yield* presentationFromAudio(kind, audio, siteUrl)
  })

export const presentationFromShow = (show: SelectMdxCompiledShow, siteUrl: string) =>
  Effect.gen(function* () {
    const slug = show.slug
    const creators = show.hosts?.map((host) => host.name) ?? []
    const imageUrl = show.bannerImageUrl ?? show.thumbnailUrl

    const metadata = makeShowSiteMetadata({
      slug,
      title: show.title,
      description: show.description,
      imageUrl,
      creators,
      publishedAt: iso(show.createdAt),
      modifiedAt: iso(show.updatedAt),
      siteUrl,
    })

    return yield* present(metadata, {
      kind: 'show',
      slug,
      title: metadata.title,
      description: metadata.description,
      detail: creators.length > 0 ? `Hosted by ${creators.join(', ')}` : null,
      imageUrl,
    })
  })

const presentationForShow = (slug: string, siteUrl: string) =>
  Effect.gen(function* () {
    const service = yield* ShowService
    const show = yield* service.getBySlug(slug)

    return yield* presentationFromShow(show, siteUrl)
  })

const presentationForRelease = (slug: string, siteUrl: string) =>
  Effect.gen(function* () {
    const releases = yield* ReleaseService
    const labels = yield* MusicEntityService
    const release = yield* releases.getBySlug(slug)
    const label = yield* labels.getLabelById(release.labelId)
    const creators = [label.name]

    const metadata = makeReleaseSiteMetadata({
      slug,
      title: release.title,
      description: release.description,
      imageUrl: release.thumbnailUrl,
      creators,
      publishedAt: iso(release.releaseDate ?? release.createdAt),
      modifiedAt: iso(release.updatedAt),
      siteUrl,
    })

    return yield* present(metadata, {
      kind: 'release',
      slug,
      title: metadata.title,
      creators,
      imageUrl: release.thumbnailUrl,
    })
  })

const presentationForLabel = (slug: string, siteUrl: string) =>
  Effect.gen(function* () {
    const service = yield* MusicEntityService
    const label = yield* service.getLabelBySlug(slug)
    const creators = label.creators.map((creator) => creator.name)

    const metadata = makeLabelSiteMetadata({
      slug,
      title: label.name,
      description: label.description,
      imageUrl: label.imageUrl,
      creators,
      publishedAt: iso(label.publishedAt ?? label.createdAt),
      modifiedAt: iso(label.updatedAt),
      siteUrl,
    })

    return yield* present(metadata, {
      kind: 'label',
      slug,
      title: metadata.title,
      description: metadata.description,
      detail: creators.length > 0 ? `Curated by ${creators.join(', ')}` : null,
      imageUrl: label.imageUrl,
    })
  })

const presentationForProfile = (username: string, siteUrl: string) =>
  Effect.gen(function* () {
    const service = yield* ProfileService
    const profile = yield* service.getPublicProfile(username)

    return yield* presentationFromProfile(profile, username, siteUrl)
  })

const presentationForPost = (kind: 'editorial' | 'tweet' | 'post', slug: string, siteUrl: string) =>
  Effect.gen(function* () {
    const service = yield* PostService

    const post = yield* Match.value(kind).pipe(
      Match.when('tweet', () => service.getMicroPostBySlug(slug)),
      Match.when('editorial', () => service.getEditorialBySlug(slug)),
      Match.when('post', () => service.getBySlug(slug)),
      Match.exhaustive,
    )

    const metadataKind = post.type === 'micro' ? 'tweet' : 'editorial'
    const creators = post.creators?.map((creator) => creator.name) ?? []

    const metadata = makePostSiteMetadata({
      kind: metadataKind,
      slug,
      title: post.title,
      description: post.description,
      imageUrl: post.thumbnailUrl,
      creators,
      publishedAt: iso(post.createdAt),
      modifiedAt: iso(post.updatedAt),
      siteUrl,
    })

    if (post.type === 'micro') {
      const input = yield* service.getTweetCardInput(post)

      const socialCard = yield* Effect.promise(() =>
        buildTweetCardPresentation({ ...input, artworkUrl: post.thumbnailUrl }),
      )

      return withGeneratedImage(metadata, socialCard)
    }

    return yield* present(metadata, {
      kind: 'editorial',
      slug,
      title: metadata.title,
      description: metadata.description,
      authors: creators,
      imageUrl: post.thumbnailUrl,
      publishedAt: metadata.publishedAt,
    })
  })

const presentationForResolvedSlug = (slug: string, siteUrl: string) =>
  Effect.gen(function* () {
    const service = yield* ResolveService
    const resolved = yield* service.resolve(slug)

    return resolved.type === 'profile'
      ? yield* presentationFromProfile(resolved.data, slug, siteUrl)
      : yield* presentationForShow(resolved.data.slug, siteUrl)
  })

/** Resolves a published route into its canonical metadata and social-card projections. */
export const resolveSitePresentation = (kind: SiteMetadataRouteKind, slug: string) =>
  Effect.gen(function* () {
    const config = yield* ConfigService
    const siteUrl = config.urls.frontend || SITE_URL

    switch (kind) {
      case 'mix':
      case 'track':
        return yield* presentationForAudio(kind, slug, siteUrl)
      case 'show':
        return yield* presentationForShow(slug, siteUrl)
      case 'release':
        return yield* presentationForRelease(slug, siteUrl)
      case 'label':
        return yield* presentationForLabel(slug, siteUrl)
      case 'profile':
        return yield* presentationForProfile(slug, siteUrl)
      case 'editorial':
      case 'tweet':
      case 'post':
        return yield* presentationForPost(kind, slug, siteUrl)
      case 'slug':
        return yield* presentationForResolvedSlug(slug, siteUrl)
      default:
        return kind satisfies never
    }
  })

/** Resolves only the metadata protocol projection for a published route. */
export const resolveSiteMetadata = (kind: SiteMetadataRouteKind, slug: string) =>
  resolveSitePresentation(kind, slug).pipe(Effect.map((presentation) => presentation.metadata))

/** Resolves only the renderer protocol projection for a published route. */
export const resolveSocialCardPresentation = (kind: SiteMetadataRouteKind, slug: string) =>
  resolveSitePresentation(kind, slug).pipe(Effect.map((presentation) => presentation.socialCard))
