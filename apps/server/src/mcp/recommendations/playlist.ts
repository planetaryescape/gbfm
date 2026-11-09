import { Clock, Effect, Schema } from 'effect'

import { getPublicPlaylistSnapshotEffect } from '@/services/music-entity/playlist.service'

import { McpAuthorization } from '../authorization'
import { EditorialToolError, EndpointIdentity } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { checkpointEditorialCommand } from '../editorial-music/save'
import { researchNotFound, researchUnavailable } from '../editorial-research/evidence'
import { compareEvidenceKeys, evidenceFingerprint } from '../editorial-research/fingerprint'
import { boundEvidenceResult, withinEvidenceBudget } from '../editorial-research/service'
import { type RecommendationLimit, type SequenceInput, SequenceResult } from './contracts'
import { proposeAlbumBlocks } from './sequence'

export const suggestPlaylistSequence = Effect.fn('MusicRecommendations.sequence')(function* (
  input: typeof SequenceInput.Type,
) {
  const authorization = yield* McpAuthorization
  const actor = yield* authorization.requireScopes(['catalogue:read'])
  yield* checkpointEditorialCommand(['catalogue:read'], actor.userId)
  const config = yield* EditorialMcpConfig
  const now = yield* Clock.currentTimeMillis
  const observedAt = new Date(now).toISOString()

  const snapshot = yield* getPublicPlaylistSnapshotEffect({
    playlistId: input.playlistId,
    now: new Date(now),
    expectedRevision: input.expectedRevision,
  }).pipe(
    Effect.catchTags({
      DatabaseError: () => Effect.fail(researchUnavailable()),
      NotFoundError: () => Effect.fail(researchNotFound()),
      ConflictError: () =>
        Effect.fail(
          new EditorialToolError({ code: 'conflict', message: 'Playlist revision changed.' }),
        ),
      ValidationError: () =>
        Effect.fail(
          new EditorialToolError({
            code: 'invalid_input',
            message: 'Complete sequence supports at most 100 distinct members.',
          }),
        ),
    }),
  )

  if (new Set(snapshot.members.map((member) => member.trackId)).size !== snapshot.members.length)
    return yield* researchUnavailable()

  if (
    snapshot.members.some(
      (member) =>
        !member.track ||
        member.track.publishedAt === null ||
        !(member.track.publishedAt.getTime() <= now),
    )
  )
    return yield* researchUnavailable()

  const members = snapshot.members.map((member) => {
    const eligibleAlbum =
      member.album?.publishedAt !== null &&
      member.album?.publishedAt !== undefined &&
      member.album.publishedAt.getTime() <= now

    return {
      trackId: member.trackId,
      position: member.position,
      albumId: eligibleAlbum ? (member.album?.id ?? null) : null,
      trackNumber: eligibleAlbum ? (member.track?.trackNumber ?? null) : null,
    }
  })

  const proposal = proposeAlbumBlocks(members)

  const assertions = yield* Effect.forEach(proposal.blocks, (block) =>
    Effect.gen(function* () {
      const albumId = block[0]?.albumId

      if (albumId === null || albumId === undefined) return yield* researchUnavailable()

      const values = {
        albumId,
        members: block.map((member) => ({
          trackId: member.trackId,
          originalPosition: member.position,
          trackNumber: member.trackNumber,
        })),
      }

      return {
        ...values,
        id: '',
        kind: 'album_track_order' as const,
        subjects: [
          { entityType: 'album' as const, entityId: albumId },
          ...block.map((member) => ({ entityType: 'track' as const, entityId: member.trackId })),
        ],
        sourceLocator: `gbfm:playlist-album-order:${encodeURIComponent(input.playlistId)}:${encodeURIComponent(albumId)}`,
        sourceFingerprint: yield* evidenceFingerprint(values),
        observedAt,
      }
    }),
  )

  const evidence = assertions
    .sort((a, b) => compareEvidenceKeys(a.sourceLocator, b.sourceLocator))
    .map((item, index) => ({ ...item, id: `e${index + 1}` }))

  const limits: Array<typeof RecommendationLimit.Type> = []

  if (new Set(members.map((member) => member.position)).size !== members.length)
    limits.push({
      code: 'tied_positions',
      affected: { entityType: 'playlist', entityId: input.playlistId },
      relationKind: null,
    })

  const inputs = {
    ...input,
    seedVersion: yield* evidenceFingerprint({
      playlistId: input.playlistId,
      revision: snapshot.playlist.revision,
      updatedAt: snapshot.playlist.updatedAt.toISOString(),
      members,
    }),
  }

  const result = {
    status: proposal.status,
    basisRevision: snapshot.playlist.revision,
    originalTrackIds: proposal.original,
    proposedTrackIds: proposal.proposed,
    changed: proposal.changed,
  }

  const output = yield* Schema.decodeUnknownEffect(SequenceResult)({
    contractVersion: 1,
    algorithmVersion: 'album_blocks_v1',
    endpoint: yield* Schema.decodeUnknownEffect(EndpointIdentity)(config).pipe(
      Effect.mapError(researchUnavailable),
    ),
    observedAt,
    inputs,
    ...result,
    limits,
    evidence,
    basisDigest: yield* evidenceFingerprint({
      contractVersion: 1,
      algorithmVersion: 'album_blocks_v1',
      inputs,
      evidence: evidence.map(({ observedAt: _observedAt, ...item }) => item),
      result,
      limits,
    }),
    candidateWindow: { examined: members.length, cap: 100, truncated: false },
    positions: proposal.proposed.map((trackId, position) => ({ trackId, position })),
    blocks: evidence.map((item) => ({
      albumId: item.albumId,
      evidenceIds: [item.id],
      explanation:
        'Group tracks by a known published album; use recorded positive track numbers, then stable original order. Not verified disc order, mood or harmonic mixing.',
    })),
  }).pipe(Effect.mapError(researchUnavailable), Effect.flatMap(boundEvidenceResult))

  yield* checkpointEditorialCommand(['catalogue:read'], actor.userId)

  return output
}, withinEvidenceBudget)
