import type { Effect } from 'effect'

import type {
  SelectMusicAlbum,
  SelectMusicArtist,
  SelectMusicEntityLink,
  SelectMusicPlaylist,
  SelectMusicTrack,
} from '@/db/music-entity.schema'
import type { CommandAuthority } from '@/mcp/command-authority'
import type { McpToolError } from '@/mcp/contracts'
import type { JsonValue, OperationKey, OperationResult } from '@/mcp/operations/store'

import type { MusicIdentityError } from './errors'
import type { CanonicalMusicEntityType, ParsedMusicSource } from './music-source'
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

export type ResolveMusicSource = {
  readonly url: string
  readonly expectedType?: CanonicalMusicEntityType
  readonly origin: ResolutionOrigin
  readonly artworkDelivery: ArtworkDelivery
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

/** Additive internal cutover contract, NOT accepted by the legacy service below.
 * Trusted composition supplies the genuine immutable namespace and required
 * checkpoint. requestId and expectedRevision must survive retries; do not invent
 * either for a legacy caller. Wire parsing/normalization precedes this boundary.
 */
export type CanonicalWriteIntent = {
  readonly key: OperationKey
  /** Includes target/revision, parsed source identity, mode and selected fields.
   * No credentials/provider payloads. Same identity for lookup and execute.
   */
  readonly normalizedInput: JsonValue
  readonly checkpoint: ReturnType<typeof CommandAuthority.of>['checkpoint']
  readonly source: ParsedMusicSource
  /** Pin before provider work. Empty overwriteFields means preserve canonical
   * public values; it does not authorize a link/alias/source write by itself.
   */
  readonly target: {
    readonly entityId: string
    readonly expectedRevision: number
  } & (
    | {
        readonly entityType: 'artist'
        readonly overwriteFields: ReadonlyArray<'name' | 'imageUrl'>
      }
    | {
        readonly entityType: 'album' | 'track'
        readonly overwriteFields: ReadonlyArray<'title' | 'coverImageUrl'>
      }
    | {
        readonly entityType: 'playlist'
        readonly overwriteFields: ReadonlyArray<'title' | 'description' | 'coverImageUrl'>
      }
  )
}

/** Required, explicitly admitted composition capability, not a raw scraper
 * fallback. Implementation must enforce bounded parsed output, cancellation,
 * destination/privacy policy and no canonical/storage/email side effects.
 * This declaration does not admit or implement any transport.
 */
export interface CanonicalReadOnlySnapshotProvider {
  readonly prepareSnapshot: (input: {
    readonly target: CanonicalWriteIntent['target']
    readonly source: ParsedMusicSource
    readonly mode: 'refresh' | 'enrich'
  }) => Effect.Effect<ProviderMusicSnapshot, MusicIdentityError>
}

/** Future replacement input; actor/type/id/revision come only from intent.
 * Remote artwork delivery additionally requires the approved staged contract;
 * carrying this policy alone confers no association authority.
 */
export type GuardedRefreshMusicEntity = {
  readonly intent: CanonicalWriteIntent
  readonly origin: RefreshMusicEntity['origin']
  readonly artworkDelivery: ArtworkDelivery
}

/** Target internal signatures for the coordinated caller cutover. No adapter or
 * optional fallback is installed. Original bounded receipt outcomes, not a fresh
 * entity read, preserve truthful replay; errors retain their typed channel.
 */
export interface CanonicalGuardedEntityOperations {
  readonly refreshEntity: (
    input: GuardedRefreshMusicEntity,
  ) => Effect.Effect<OperationResult, MusicIdentityError | McpToolError>
  readonly enrichEntity: (
    input: GuardedRefreshMusicEntity,
  ) => Effect.Effect<OperationResult, MusicIdentityError | McpToolError>
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
