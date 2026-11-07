import type { Effect } from 'effect'

import type {
  SelectMusicAlbum,
  SelectMusicArtist,
  SelectMusicEntityLink,
  SelectMusicPlaylist,
  SelectMusicTrack,
} from '@/db/music-entity.schema'

import type { MusicIdentityAuthorizationFailed, MusicIdentityError } from './errors'
import type { CanonicalMusicEntityType } from './music-source'
import type { ProviderMusicSnapshot } from './source-result'

export const ARTWORK_DELIVERY = {
  preserve: 'preserve',
  required: 'required',
  bestEffort: 'best_effort',
} as const

export type ArtworkDelivery = (typeof ARTWORK_DELIVERY)[keyof typeof ARTWORK_DELIVERY]

export type ResolutionOrigin =
  | 'editorial'
  | 'tweet'
  | 'reply'
  | 'bluesky'
  | 'spotify_import'
  | 'playlist_enrichment'
  | 'manual'

export type MusicIdentityAuthorization = (
  entityType?: CanonicalMusicEntityType,
) => Effect.Effect<void, MusicIdentityAuthorizationFailed>

export type ResolveMusicSource = {
  readonly url: string
  readonly expectedType?: CanonicalMusicEntityType
  readonly origin: ResolutionOrigin
  readonly artworkDelivery: ArtworkDelivery
  // Existing non-MCP callers retain their owning boundary's authorization.
  // A receipt-aware caller must supply fresh authority at every checkpoint.
  readonly authorize?: MusicIdentityAuthorization
}

export type ImportProviderMusicEntity = {
  readonly snapshot: ProviderMusicSnapshot
  readonly origin: 'spotify_import' | 'playlist_enrichment'
  readonly artworkDelivery: ArtworkDelivery
}

export type ImportProviderMusicEntityLazy<E, R> = {
  readonly entityType: CanonicalMusicEntityType
  readonly sourceUrl: string
  readonly origin: 'spotify_import' | 'playlist_enrichment'
  readonly artworkDelivery: ArtworkDelivery
  readonly loadSnapshot: Effect.Effect<ProviderMusicSnapshot, E, R>
}

export type AttachMusicSourceLink = {
  readonly entityType: CanonicalMusicEntityType
  readonly entityId: string
  readonly platform: string
  readonly url: string
  readonly origin: 'manual'
}

export type ReleaseMusicSourceLink = {
  readonly entityType: CanonicalMusicEntityType
  readonly entityId: string
  readonly linkId: string
  readonly action: 'reject' | 'delete'
  readonly verifiedBy?: string
  readonly metadata?: SelectMusicEntityLink['metadata']
}

export type RefreshMusicEntity = {
  readonly entityType: CanonicalMusicEntityType
  readonly entityId: string
  readonly actorId: string
  readonly origin: 'manual' | 'playlist_enrichment'
  readonly artworkDelivery: ArtworkDelivery
}

export type MusicEntityByType = {
  readonly artist: SelectMusicArtist
  readonly album: SelectMusicAlbum
  readonly track: SelectMusicTrack
  readonly playlist: SelectMusicPlaylist & { readonly spotifyUrl?: string | null }
}

export type ResolvedMusicEntity<T extends CanonicalMusicEntityType = CanonicalMusicEntityType> = {
  readonly entityType: T
  readonly entity: MusicEntityByType[T]
  readonly links: ReadonlyArray<SelectMusicEntityLink>
  readonly created: boolean
}

export type AnyResolvedMusicEntity = {
  readonly [T in CanonicalMusicEntityType]: ResolvedMusicEntity<T>
}[CanonicalMusicEntityType]

export interface CanonicalMusicIdentityService {
  readonly resolveSource: (
    input: ResolveMusicSource,
  ) => Effect.Effect<AnyResolvedMusicEntity, MusicIdentityError>
  readonly importProviderEntity: (
    input: ImportProviderMusicEntity,
  ) => Effect.Effect<AnyResolvedMusicEntity, MusicIdentityError>
  readonly importProviderEntityLazy: <E, R>(
    input: ImportProviderMusicEntityLazy<E, R>,
  ) => Effect.Effect<AnyResolvedMusicEntity, MusicIdentityError | E, R>
  readonly attachLink: (
    input: AttachMusicSourceLink,
  ) => Effect.Effect<SelectMusicEntityLink, MusicIdentityError>
  readonly releaseLink: (
    input: ReleaseMusicSourceLink,
  ) => Effect.Effect<SelectMusicEntityLink | undefined, MusicIdentityError>
  readonly enrichEntity: (
    input: RefreshMusicEntity,
  ) => Effect.Effect<AnyResolvedMusicEntity, MusicIdentityError>
  readonly refreshEntity: (
    input: RefreshMusicEntity,
  ) => Effect.Effect<AnyResolvedMusicEntity, MusicIdentityError>
}
