import type { McpResourceUrl } from '@gbfm/core/editorial-mcp'
import { Context, DateTime, Effect, Layer, Option, Schema } from 'effect'

import { McpAuthorization } from '@/mcp/authorization'
import { McpToolError } from '@/mcp/contracts'
import { parseMusicSource } from '@/services/canonical-music-identity/music-source'

const text = Schema.NonEmptyString.check(
  Schema.isMaxLength(500),
  Schema.makeFilter((value) => value.trim().length > 0),
)

const description = Schema.String.check(Schema.isMaxLength(2000))

const strings = Schema.Array(text).check(Schema.isMaxLength(50))

const optionalText = Schema.optionalKey(Schema.NullOr(description))

const optionalStrings = Schema.optionalKey(Schema.NullOr(strings))

const image = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter((value) => {
    const url = URL.parse(value)

    return url !== null && url.protocol === 'https:' && !url.username && !url.password
  }),
)

const optionalImage = Schema.optionalKey(Schema.NullOr(image))

const requestId = Schema.String.check(Schema.isUUID(4))

export const ImportMusicUrlInput = Schema.Struct({
  requestId,
  url: Schema.NonEmptyString.check(Schema.isMaxLength(2048)),
  expectedType: Schema.optionalKey(Schema.Literals(['artist', 'album', 'track', 'playlist'])),
  artworkDelivery: Schema.Literals(['preserve', 'required', 'best_effort']),
})

export const CreateArtistInput = Schema.Struct({
  requestId,
  name: text,
  slug: text,
  bio: optionalText,
  imageUrl: optionalImage,
  genres: optionalStrings,
})

export const CreateAlbumInput = Schema.Struct({
  requestId,
  title: text,
  slug: text,
  artistNames: optionalStrings,
  artistIds: Schema.optionalKey(strings),
  releaseDate: Schema.optionalKey(
    Schema.NullOr(
      Schema.String.check(
        Schema.makeFilter((value) =>
          Option.match(DateTime.make(value), {
            onNone: () => false,
            onSome: (date) => DateTime.formatIso(date) === value,
          }),
        ),
      ),
    ),
  ),
  coverImageUrl: optionalImage,
  genres: optionalStrings,
  albumType: Schema.optionalKey(Schema.NullOr(text)),
})

export const CreateTrackInput = Schema.Struct({
  requestId,
  title: text,
  slug: text,
  artistNames: optionalStrings,
  artistIds: Schema.optionalKey(strings),
  coverImageUrl: optionalImage,
  albumId: Schema.optionalKey(Schema.NullOr(text)),
  trackNumber: Schema.optionalKey(
    Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  ),
})

export const CreateLabelInput = Schema.Struct({
  requestId,
  name: text,
  slug: text,
  content: Schema.String.check(Schema.isMaxLength(100_000)),
  description: optionalText,
  imageUrl: optionalImage,
  bannerImageUrl: optionalImage,
  tags: optionalStrings,
  genres: optionalStrings,
})

const command = Schema.Union([
  Schema.Struct({ operation: Schema.Literal('import_music_url'), input: ImportMusicUrlInput }),
  Schema.Struct({ operation: Schema.Literal('create_artist'), input: CreateArtistInput }),
  Schema.Struct({ operation: Schema.Literal('create_album'), input: CreateAlbumInput }),
  Schema.Struct({ operation: Schema.Literal('create_track'), input: CreateTrackInput }),
  Schema.Struct({ operation: Schema.Literal('create_label'), input: CreateLabelInput }),
])

const invalid = () =>
  new McpToolError({ code: 'invalid_input', message: 'Invalid music import command.' })

// The flat input schemas have only scalar values and scalar arrays. Sort field
// names, not array values: artist order and omitted/null fields are meaningful.
const fingerprint = Effect.fn('MusicImportCommands.fingerprint')(function* (
  value: typeof command.Type,
) {
  const payload = JSON.stringify([
    value.operation,
    Object.entries(value.input)
      .filter(([key]) => key !== 'requestId')
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  ])

  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)),
    catch: () =>
      new McpToolError({ code: 'unavailable', message: 'Music command preparation unavailable.' }),
  })

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
})

const makeCommands = Effect.gen(function* () {
  const authorization = yield* McpAuthorization

  // Preparation is deliberately NOT acceptance or execution. No receipt store
  // currently satisfies P0; callers must not register these as mutating tools.
  const prepare = Effect.fn('MusicImportCommands.prepare')(
    function* (raw: Schema.Json, resource: McpResourceUrl) {
      yield* authorization.highTrust('catalogue:write')

      const decoded = yield* Schema.decodeUnknownEffect(command)(raw, {
        onExcessProperty: 'error',
      }).pipe(Effect.mapError(invalid))

      if (new TextEncoder().encode(JSON.stringify(decoded)).byteLength > 256 * 1024) {
        return yield* invalid()
      }

      const actor = yield* authorization.requireScopes(
        decoded.operation === 'import_music_url'
          ? decoded.input.expectedType === 'playlist'
            ? ['catalogue:write', 'catalogue:import', 'providers:read', 'playlists:write']
            : ['catalogue:write', 'catalogue:import', 'providers:read']
          : ['catalogue:write'],
      )

      let normalized = decoded
      let typeAuthority: 'resolved' | 'pending' = 'resolved'

      if (decoded.operation === 'import_music_url') {
        const source = yield* parseMusicSource(decoded.input.url, decoded.input.expectedType).pipe(
          Effect.mapError(invalid),
        )

        if (source.sourceEntityType === 'url' || source.sourceEntityType === 'video') {
          typeAuthority = 'pending'
        }

        // A playlist can also be inferred from the URL; omission is no scope bypass.
        if (source.sourceEntityType === 'playlist') {
          yield* authorization.highTrust('playlists:write')
        }

        normalized = {
          operation: decoded.operation,
          input: { ...decoded.input, url: source.canonicalUrl },
        }
      }

      return {
        command: normalized,
        typeAuthority,
        receiptScope: {
          actorId: actor.userId,
          clientId: actor.clientId,
          resource,
          operation: decoded.operation,
          requestId: decoded.input.requestId,
        },
        inputHash: yield* fingerprint(normalized),
      }
    },
    Effect.catchTag('EditorialToolError', ({ code, message }) =>
      Effect.fail(new McpToolError({ code, message })),
    ),
  )

  return { prepare }
})

export class MusicImportCommands extends Context.Service<
  MusicImportCommands,
  Effect.Success<typeof makeCommands>
>()('gbfm/mcp/MusicImportCommands') {}

export const MusicImportCommandsLayer = Layer.effect(MusicImportCommands, makeCommands)
