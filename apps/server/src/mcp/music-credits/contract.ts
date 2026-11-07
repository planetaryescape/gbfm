import { Effect, Schema } from 'effect'

import { McpToolError } from '../contracts'

const id = Schema.String.check(Schema.isUUID())

const text = (maximum: number) =>
  Schema.String.check(Schema.makeFilter((value) => !/\p{Cc}/u.test(value)))
    .pipe(Schema.decodeTo(Schema.Trim))
    .check(
      Schema.makeFilter(
        (value) =>
          Array.from(value).length >= 1 &&
          Array.from(value).length <= maximum &&
          !/\p{Cc}/u.test(value),
      ),
    )

const sourceUrl = text(2048).check(
  Schema.makeFilter((value) => {
    const url = URL.parse(value)

    if (
      !url ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false
    const host = url.hostname.toLowerCase()

    if (host === 'localhost' || host.endsWith('.localhost')) return false

    if (host.startsWith('[')) {
      return !/^\[(?:::|fc|fd|fe[89a-f]|ff)/i.test(host)
    }

    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number)

      if (a === undefined || b === undefined) return false

      return !(
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127)
      )
    }

    return true
  }),
)

const evidence = {
  sourceLabel: text(200),
  sourceUrl: Schema.optionalKey(sourceUrl),
  evidenceNote: Schema.optionalKey(text(1000)),
}

const hasEvidence = (item: { readonly sourceUrl?: string; readonly evidenceNote?: string }) =>
  item.sourceUrl !== undefined || item.evidenceNote !== undefined

const credit = Schema.Struct({
  id: Schema.optionalKey(id),
  artistId: Schema.optionalKey(Schema.NullOr(id)),
  creditedName: text(200),
  role: Schema.Literals(['performer', 'instrument', 'producer', 'engineer']),
  instrument: Schema.optionalKey(text(200)),
  ...evidence,
}).check(
  Schema.makeFilter(hasEvidence),
  Schema.makeFilter((item) => (item.role === 'instrument') === (item.instrument !== undefined)),
  Schema.makeFilter((item) => item.artistId !== null || item.id !== undefined),
)

const alias = Schema.Struct({
  id: Schema.optionalKey(id),
  name: text(200),
  ...evidence,
}).check(Schema.makeFilter(hasEvidence))

const common = {
  requestId: Schema.String.check(Schema.isUUID(4)),
  expectedVersion: Schema.String.check(Schema.isPattern(/^music:sha256:[a-f0-9]{64}$/)),
}

/** Complete replacement input. Decode through parseRecordingCredits to enforce byte limits. */
export const SetRecordingCreditsInput = Schema.Struct({
  ...common,
  target: Schema.Struct({ type: Schema.Literals(['track', 'album']), id }),
  credits: Schema.Array(credit).check(
    Schema.isMaxLength(50),
    Schema.makeFilter((items) => {
      const ids = new Set<string>()
      const facts = new Set<string>()

      for (const item of items) {
        if (item.id !== undefined) {
          if (ids.has(item.id)) return false
          ids.add(item.id)
        }

        const participant = item.artistId
          ? `artist:${item.artistId}`
          : `name:${musicFactNameKey(item.creditedName)}`

        const key = JSON.stringify([
          participant,
          item.role,
          item.instrument ? musicFactNameKey(item.instrument) : '',
        ])

        if (facts.has(key)) return false
        facts.add(key)
      }

      return true
    }),
  ),
})

/** Complete alias replacement. Decode through parseArtistAliases to enforce byte limits. */
export const SetArtistAliasesInput = Schema.Struct({
  ...common,
  artistId: id,
  aliases: Schema.Array(alias).check(
    Schema.isMaxLength(50),
    Schema.makeFilter((items) => {
      const ids = new Set<string>()
      const names = new Set<string>()

      for (const item of items) {
        if (item.id !== undefined) {
          if (ids.has(item.id)) return false
          ids.add(item.id)
        }

        const key = musicFactNameKey(item.name)

        if (names.has(key)) return false
        names.add(key)
      }

      return true
    }),
  ),
})

const invalid = () =>
  new McpToolError({ code: 'invalid_input', message: 'Invalid music facts input.' })

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: This is the concrete untrusted MCP admission boundary, before schema decoding.
const admit = Effect.fn('MusicCredits.admit')(function* (raw: unknown) {
  if (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- SAFETY: Distinguish the missing-version precondition before strict object decoding.
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    !('expectedVersion' in raw)
  ) {
    return yield* new McpToolError({
      code: 'precondition_required',
      message: 'Read the complete collection and supply its expectedVersion.',
    })
  }

  const encoded = yield* Effect.try({ try: () => JSON.stringify(raw), catch: invalid })

  if (encoded === undefined || new TextEncoder().encode(encoded).length > 128 * 1024) {
    return yield* invalid()
  }

  return undefined
})

/** Parse strict, bounded credit commands; no storage or identity lookup takes place. */
export const parseRecordingCredits = Effect.fn('MusicCredits.parseRecordingCredits')(function* (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: Public boundary parser immediately decodes this value with the concrete strict schema.
  raw: unknown,
) {
  yield* admit(raw)

  return yield* Schema.decodeUnknownEffect(SetRecordingCreditsInput, { onExcessProperty: 'error' })(
    raw,
  ).pipe(Effect.mapError(invalid))
})

/** Parse strict, bounded alias commands; null and missing arrays never clear a collection. */
export const parseArtistAliases = Effect.fn('MusicCredits.parseArtistAliases')(function* (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: Public boundary parser immediately decodes this value with the concrete strict schema.
  raw: unknown,
) {
  yield* admit(raw)

  return yield* Schema.decodeUnknownEffect(SetArtistAliasesInput, { onExcessProperty: 'error' })(
    raw,
  ).pipe(Effect.mapError(invalid))
})

/** Version-1 duplicate comparison key; never use this to resolve an artist identity. */
export const musicFactNameKey = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase().normalize('NFC')

/** After receipt lookup, check row ownership and explicit unlink intent against current state. */
export const checkCreditReplacement = Effect.fn('MusicCredits.checkCreditReplacement')(function* (
  input: typeof SetRecordingCreditsInput.Type,
  existing: ReadonlyArray<{ readonly id: string; readonly artistId: string | null }>,
) {
  const rows = new Map(existing.map((row) => [row.id, row]))

  for (const item of input.credits) {
    if (item.id !== undefined) {
      const previous = rows.get(item.id)

      if (
        !previous ||
        (previous.artistId !== null && item.artistId === undefined) ||
        (previous.artistId === null && item.artistId === null)
      ) {
        return yield* invalid()
      }
    }
  }

  return input
})

/** After receipt lookup, reject foreign alias IDs and current primary-name collisions. */
export const checkAliasReplacement = Effect.fn('MusicCredits.checkAliasReplacement')(function* (
  input: typeof SetArtistAliasesInput.Type,
  primaryName: string,
  existingIds: ReadonlyArray<string>,
) {
  const allowed = new Set(existingIds)

  for (const item of input.aliases) {
    if (item.id !== undefined) {
      if (!allowed.has(item.id)) return yield* invalid()
    }

    const key = musicFactNameKey(item.name)

    if (musicFactNameKey(primaryName) === key) return yield* invalid()
  }

  return input
})
