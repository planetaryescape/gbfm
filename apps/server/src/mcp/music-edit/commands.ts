import { Schema } from 'effect'

import { ALBUM_TYPES } from '@/db/music-entity.schema'

export const MusicEditId = Schema.NonEmptyString.check(
  Schema.isMaxLength(200),
  Schema.makeFilter((value) => value.trim() === value && value.length > 0),
)

export const MusicRevision = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
)

const title = Schema.NonEmptyString.check(
  Schema.isMaxLength(500),
  Schema.makeFilter((value) => value.trim() === value && value.length > 0),
)

const description = Schema.NullOr(Schema.String.check(Schema.isMaxLength(10_000)))

const releaseDate = Schema.NullOr(
  Schema.String.check(
    Schema.makeFilter((value) => {
      const date = new Date(value)

      return Number.isFinite(date.getTime()) && date.toISOString() === value
    }),
  ),
)

const artistMetadata = Schema.Struct({
  name: Schema.optionalKey(title),
  bio: Schema.optionalKey(description),
}).check(Schema.makeFilter((value) => value.name !== undefined || value.bio !== undefined))

const albumMetadata = Schema.Struct({
  title: Schema.optionalKey(title),
  releaseDate: Schema.optionalKey(releaseDate),
}).check(Schema.makeFilter((value) => value.title !== undefined || value.releaseDate !== undefined))

const trackMetadata = Schema.Struct({
  title: Schema.optionalKey(title),
  trackNumber: Schema.optionalKey(
    Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 }))),
  ),
}).check(Schema.makeFilter((value) => value.title !== undefined || value.trackNumber !== undefined))

const labelMetadata = Schema.Struct({
  name: Schema.optionalKey(title),
  description: Schema.optionalKey(description),
}).check(Schema.makeFilter((value) => value.name !== undefined || value.description !== undefined))

// Every nullable value must be present to clear it; absence means no change only
// inside these explicit metadata patches. Identity/publication/artwork are not edits.
export const MusicEditChange = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal('update_music_metadata'),
    entityType: Schema.Literal('artist'),
    entityId: MusicEditId,
    metadata: artistMetadata,
  }),
  Schema.Struct({
    operation: Schema.Literal('update_music_metadata'),
    entityType: Schema.Literal('album'),
    entityId: MusicEditId,
    metadata: albumMetadata,
  }),
  Schema.Struct({
    operation: Schema.Literal('update_music_metadata'),
    entityType: Schema.Literal('track'),
    entityId: MusicEditId,
    metadata: trackMetadata,
  }),
  Schema.Struct({
    operation: Schema.Literal('update_music_metadata'),
    entityType: Schema.Literal('label'),
    entityId: MusicEditId,
    metadata: labelMetadata,
  }),
  Schema.Struct({
    operation: Schema.Literal('set_music_genres'),
    entityType: Schema.Literals(['artist', 'album', 'track', 'label']),
    entityId: MusicEditId,
    genres: Schema.Array(
      Schema.NonEmptyString.check(
        Schema.isMaxLength(100),
        Schema.makeFilter((value) => value.trim() === value && value.length > 0),
      ),
    ).check(
      Schema.isMaxLength(30),
      Schema.makeFilter((values) => new Set(values).size === values.length),
    ),
  }),
  Schema.Struct({
    operation: Schema.Literal('set_album_type'),
    entityId: MusicEditId,
    albumType: Schema.NullOr(Schema.Literals(ALBUM_TYPES)),
  }),
  Schema.Struct({
    operation: Schema.Literal('set_track_album'),
    entityId: MusicEditId,
    albumId: Schema.NullOr(MusicEditId),
  }),
  Schema.Struct({
    operation: Schema.Literal('set_artist_credit'),
    entityType: Schema.Literals(['album', 'track']),
    entityId: MusicEditId,
    artistId: MusicEditId,
    role: Schema.NullOr(Schema.Literals(['primary', 'featured', 'producer'])),
    displayOrder: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 })),
  }),
  Schema.Struct({
    operation: Schema.Literal('remove_artist_credit'),
    entityType: Schema.Literals(['album', 'track']),
    entityId: MusicEditId,
    artistId: MusicEditId,
  }),
  Schema.Struct({
    operation: Schema.Literals(['set_label_affiliation', 'remove_label_affiliation']),
    entityType: Schema.Literals(['artist', 'album']),
    entityId: MusicEditId,
    labelId: MusicEditId,
  }),
]).annotate({ parseOptions: { onExcessProperty: 'error' } })

export type MusicEditChange = typeof MusicEditChange.Type

export const musicEditReference = (
  change: MusicEditChange,
): { readonly entityType: 'artist' | 'album' | 'label'; readonly entityId: string } | null => {
  switch (change.operation) {
    case 'set_track_album':
      return change.albumId === null ? null : { entityType: 'album', entityId: change.albumId }
    case 'set_artist_credit':
    case 'remove_artist_credit':
      return { entityType: 'artist', entityId: change.artistId }
    case 'set_label_affiliation':
    case 'remove_label_affiliation':
      return { entityType: 'label', entityId: change.labelId }
    default:
      return null
  }
}

export const MusicEditPreviewInput = Schema.Struct({ change: MusicEditChange }).annotate({
  parseOptions: { onExcessProperty: 'error' },
})

export const MusicEditCommand = Schema.Struct({
  requestId: Schema.String.check(Schema.isUUID(4)),
  expectedRevision: MusicRevision,
  // Referenced artist/album/label versions are observed with the preview. A clear
  // has no reference; apply verifies the exact reference set rather than guessing.
  references: Schema.Array(
    Schema.Struct({
      entityType: Schema.Literals(['artist', 'album', 'label']),
      entityId: MusicEditId,
      expectedRevision: MusicRevision,
    }),
  ).check(Schema.isMaxLength(1)),
  change: MusicEditChange,
})
  .check(
    Schema.makeFilter((command) => {
      const required = musicEditReference(command.change)
      const supplied = command.references[0]

      return required === null
        ? command.references.length === 0
        : command.references.length === 1 &&
            supplied?.entityType === required.entityType &&
            supplied.entityId === required.entityId
    }),
  )
  .annotate({ parseOptions: { onExcessProperty: 'error' } })

export type MusicEditCommand = typeof MusicEditCommand.Type
