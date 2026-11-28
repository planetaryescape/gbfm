import { Context, Effect, Layer, Option, Schema } from 'effect'

import { CreatorDraftSchema, CreatorStorageError, type CreatorDraft } from './services'

export const LegacyRecoveryPrincipal = Schema.Struct({
  id: Schema.String,
  username: Schema.NullOr(Schema.String),
})

export const LegacyRecoveryToken = Schema.Struct({
  ownerId: Schema.String,
  key: Schema.String,
  fingerprint: Schema.String,
})

export const LegacyRecoveryCandidate = Schema.Struct({
  draft: CreatorDraftSchema,
  token: LegacyRecoveryToken,
})

type StoragePort = Pick<Storage, 'getItem' | 'setItem'>

const ownerKey = 'gbfm:creator:legacy-recovery:v1:owner'

const handledKey = (key: string) => `gbfm:creator:legacy-recovery:v1:handled:${key}`

const failure = () =>
  new CreatorStorageError({
    operation: 'read',
    message: 'Legacy recovery could not finish safely. The original draft has been kept.',
  })

const fingerprint = (value: string) =>
  Effect.tryPromise({
    try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    catch: failure,
  }).pipe(
    Effect.map((bytes) =>
      Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    ),
  )

const legacyKey = (key: string, principal: typeof LegacyRecoveryPrincipal.Type) => {
  if (principal.username !== 'guidefari' || !principal.id || !key.startsWith(`${principal.id}:`))
    return null
  const context = key.slice(principal.id.length + 1)

  return /^(micro|post|mix):.+$/.test(context) ? `gbfm:creator:${context}` : null
}

const decodeDraft = Schema.decodeUnknownOption(Schema.fromJsonString(CreatorDraftSchema))

const matchesContext = (draft: CreatorDraft, key: string) =>
  key === `gbfm:creator:${draft.kind}:${draft.editSlug ?? 'new'}` ||
  key === `gbfm:creator:${draft.kind}:new`

const destinationKey = (ownerId: string, draft: CreatorDraft) =>
  `gbfm:creator:${ownerId}:${draft.kind}:${draft.editSlug ?? 'new'}`

export const makeLegacyRecovery = (storage: StoragePort) => ({
  read: (key: string, principal: typeof LegacyRecoveryPrincipal.Type) =>
    Effect.gen(function* () {
      const legacy = legacyKey(key, principal)

      if (!legacy) return null
      const scoped = `gbfm:creator:${key}`

      const observed = yield* Effect.try({
        try: () => ({
          scoped: storage.getItem(scoped),
          owner: storage.getItem(ownerKey),
          raw: storage.getItem(legacy),
          handled: storage.getItem(handledKey(legacy)),
        }),
        catch: failure,
      })

      if (
        observed.scoped !== null ||
        observed.raw === null ||
        (observed.owner !== null && observed.owner !== principal.id)
      )
        return null
      const decoded = decodeDraft(observed.raw)

      if (Option.isNone(decoded) || !matchesContext(decoded.value, legacy)) return null
      const destination = destinationKey(principal.id, decoded.value)

      const existing = yield* Effect.try({
        try: () => storage.getItem(destination),
        catch: failure,
      })

      if (existing !== null) return null
      const hash = yield* fingerprint(observed.raw)

      if (observed.handled === hash) return null

      return yield* Effect.try({
        try: () => {
          if (
            storage.getItem(scoped) !== null ||
            storage.getItem(destination) !== null ||
            storage.getItem(legacy) !== observed.raw ||
            storage.getItem(ownerKey) !== observed.owner ||
            storage.getItem(handledKey(legacy)) !== observed.handled
          )
            return null

          if (observed.owner === null) storage.setItem(ownerKey, principal.id)

          if (
            storage.getItem(ownerKey) !== principal.id ||
            storage.getItem(scoped) !== null ||
            storage.getItem(destination) !== null ||
            storage.getItem(legacy) !== observed.raw
          )
            return null

          return {
            draft: decoded.value,
            token: { ownerId: principal.id, key: legacy, fingerprint: hash },
          }
        },
        catch: failure,
      })
    }),
  resolve: (
    key: string,
    principal: typeof LegacyRecoveryPrincipal.Type,
    token: typeof LegacyRecoveryToken.Type,
    action: 'restore' | 'dismiss',
  ) =>
    Effect.gen(function* () {
      const legacy = legacyKey(key, principal)

      if (!legacy || legacy !== token.key || token.ownerId !== principal.id)
        return yield* Effect.fail(failure())
      const scoped = `gbfm:creator:${key}`

      const raw = yield* Effect.try({ try: () => storage.getItem(legacy), catch: failure })

      if (raw === null) return yield* Effect.fail(failure())
      const decoded = decodeDraft(raw)

      if (Option.isNone(decoded) || !matchesContext(decoded.value, legacy))
        return yield* Effect.fail(failure())
      const destination = destinationKey(principal.id, decoded.value)
      const hash = yield* fingerprint(raw)

      if (hash !== token.fingerprint) return yield* Effect.fail(failure())

      return yield* Effect.try({
        try: () => {
          if (
            storage.getItem(ownerKey) !== principal.id ||
            storage.getItem(scoped) !== null ||
            storage.getItem(destination) !== null ||
            storage.getItem(legacy) !== raw ||
            storage.getItem(handledKey(legacy)) === hash
          )
            throw failure()

          if (action === 'restore') storage.setItem(destination, raw)
          storage.setItem(handledKey(legacy), hash)

          return action === 'restore' ? decoded.value : null
        },
        catch: failure,
      })
    }),
})

export class CreatorLegacyRecovery extends Context.Service<
  CreatorLegacyRecovery,
  ReturnType<typeof makeLegacyRecovery>
>()('creator/LegacyRecovery') {}

export const CreatorLegacyRecoveryLive = Layer.succeed(CreatorLegacyRecovery, {
  read: (key, principal) =>
    Effect.try({ try: () => localStorage, catch: failure }).pipe(
      Effect.flatMap((storage) => makeLegacyRecovery(storage).read(key, principal)),
    ),
  resolve: (key, principal, token, action) =>
    Effect.try({ try: () => localStorage, catch: failure }).pipe(
      Effect.flatMap((storage) =>
        makeLegacyRecovery(storage).resolve(key, principal, token, action),
      ),
    ),
})
