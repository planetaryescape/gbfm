import { Effect, Schema } from 'effect'

import { ConflictError, ValidationError } from '@/errors'

import { LocalPlaylistCommand, PlaylistMetadata, PlaylistRevision } from './contracts'

const Instant = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8_640_000_000_000_000 }))

const Member = Schema.Struct({
  trackId: Schema.NonEmptyString,
  position: Schema.Int.check(
    Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
  ),
  addedAt: Instant,
})

export const PlaylistState = Schema.Struct({
  playlistId: Schema.NonEmptyString,
  revision: PlaylistRevision,
  metadata: PlaylistMetadata,
  publishedAt: Schema.NullOr(Instant),
  members: Schema.Array(Member).check(
    Schema.isMaxLength(500),
    Schema.makeFilter(
      (members) => new Set(members.map((member) => member.trackId)).size === members.length,
    ),
  ),
})

export type PlaylistState = typeof PlaylistState.Type

const invalid = (message: string) => new ValidationError({ message })

/**
 * Pure desired-state contract for BOTH preview and eventual guarded persistence.
 * It supplies no authority, receipt, identity allocation, SQL or provider effects.
 * The caller must prove live authority and CAS the exact observed revision in D1.
 */
export const planPlaylistChanges = Effect.fn('playlist.planChanges')(function* (input: {
  readonly command: LocalPlaylistCommand
  readonly snapshot: PlaylistState | null
  readonly now: number
  /** One bounded catalogue existence read for an add; never inferred from provider URLs. */
  readonly catalogueTrackIds: ReadonlySet<string>
}) {
  const command = yield* Schema.decodeUnknownEffect(LocalPlaylistCommand, {
    onExcessProperty: 'error',
  })(input.command).pipe(Effect.mapError(() => invalid('Invalid playlist command.')))

  const now = yield* Schema.decodeUnknownEffect(Instant)(input.now).pipe(
    Effect.mapError(() => invalid('Invalid captured playlist time.')),
  )

  if (command.operation === 'create_playlist') {
    if (input.snapshot !== null)
      return yield* invalid('Create cannot replace an existing playlist.')

    return {
      operation: command.operation,
      playlistId: null,
      expectedRevision: null,
      revision: 0,
      changed: true,
      before: null,
      after: { metadata: command.metadata, publishedAt: null, members: [] },
    }
  }

  if (input.snapshot === null) return yield* invalid('Playlist snapshot required.')

  const snapshot = yield* Schema.decodeUnknownEffect(PlaylistState)(input.snapshot).pipe(
    Effect.mapError(() => invalid('Invalid or oversized playlist snapshot.')),
  )

  if (snapshot.playlistId !== command.playlistId)
    return yield* invalid('Playlist snapshot target mismatch.')

  if (snapshot.revision !== command.expectedRevision)
    return yield* new ConflictError({ message: 'Playlist revision changed.' })

  const before = {
    metadata: snapshot.metadata,
    publishedAt: snapshot.publishedAt,
    members: snapshot.members.toSorted(
      (left, right) =>
        left.position - right.position ||
        (left.trackId < right.trackId ? -1 : left.trackId > right.trackId ? 1 : 0),
    ),
  }

  let metadata = before.metadata
  let publishedAt = before.publishedAt
  let members = before.members

  switch (command.operation) {
    case 'update_playlist':
      // Missing keys preserve the field; explicit null clears nullable metadata.
      metadata = { ...metadata, ...command.metadata }
      break
    case 'add_playlist_tracks': {
      if (command.trackIds.some((id) => !input.catalogueTrackIds.has(id)))
        return yield* invalid('Every added track must already exist in the GBFM catalogue.')

      const present = new Set(members.map((member) => member.trackId))
      const additions = command.trackIds.filter((id) => !present.has(id))
      const lastPosition = members.at(-1)?.position ?? -1

      if (members.length + additions.length > 500)
        return yield* invalid('Playlist curation supports at most 500 memberships.')

      if (lastPosition > Number.MAX_SAFE_INTEGER - additions.length)
        return yield* invalid('Playlist position overflow; explicitly reorder first.')

      members = [
        ...members,
        ...additions.map((trackId, index) => ({
          trackId,
          position: lastPosition + index + 1,
          addedAt: now,
        })),
      ]
      break
    }

    case 'remove_playlist_tracks': {
      const removals = new Set(command.trackIds)
      members = members.filter((member) => !removals.has(member.trackId))
      break
    }

    case 'reorder_playlist_tracks': {
      const byId = new Map(members.map((member) => [member.trackId, member]))

      if (
        command.trackIds.length !== members.length ||
        command.trackIds.some((id) => !byId.has(id))
      )
        return yield* invalid('Reorder must name every current track exactly once.')

      members = members
        .map((member) => ({ ...member, position: command.trackIds.indexOf(member.trackId) }))
        .toSorted((left, right) => left.position - right.position)
      break
    }

    case 'publish_playlist':
      // Already-public publish is a no-op, not an incidental re-publication timestamp.
      if (publishedAt === null || publishedAt > now) publishedAt = now
      break
    case 'unpublish_playlist':
      publishedAt = null
      break
  }

  const after = { metadata, publishedAt, members }
  const changed = JSON.stringify(before) !== JSON.stringify(after)

  if (changed && snapshot.revision === Number.MAX_SAFE_INTEGER)
    return yield* invalid('Playlist revision exhausted.')

  return {
    operation: command.operation,
    playlistId: snapshot.playlistId,
    expectedRevision: snapshot.revision,
    revision: snapshot.revision + Number(changed),
    changed,
    before,
    after,
  }
})
