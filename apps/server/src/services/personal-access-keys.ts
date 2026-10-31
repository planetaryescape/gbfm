import { Credential, type PersonalAccessKeyActor } from '@gbfm/api/middleware/actor'
import {
  InvalidKeyCredential,
  KeyAccessDenied,
  KeyInputInvalid,
  KeyIssuanceConflict,
  KeyLimitReached,
  KeyRateLimited,
  KeyStoreUnavailable,
  type IssueKeyInput,
} from '@gbfm/api/personal-access-keys'
import {
  canAuthorWithKey,
  canPublishWithKey,
  KeyEnvironment,
  KeyScopes,
} from '@gbfm/core/personal-access-keys'
import { and, count, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { Clock, Context, Crypto, Effect, Layer, Redacted, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { personalAccessKeys as keys } from '@/db/personal-access-key.schema'
import { ConfigService } from '@/services/config.service'

type KeyRow = typeof keys.$inferSelect

const storage = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: () => new KeyStoreUnavailable(),
  })

const decodeScopes = Schema.decodeUnknownEffect(Schema.fromJsonString(KeyScopes))

const metadata = (row: KeyRow) =>
  Effect.gen(function* () {
    const environment = yield* Schema.decodeUnknownEffect(KeyEnvironment)(row.environment).pipe(
      Effect.mapError(() => new KeyStoreUnavailable()),
    )

    const scopes = yield* decodeScopes(row.scopes).pipe(
      Effect.mapError(() => new KeyStoreUnavailable()),
    )

    if (
      !/^[0-9a-f]{64}$/.test(row.secretHash) ||
      !new RegExp(`^gbfm_pat_v1_${environment}_[A-Za-z0-9_-]{6}$`).test(row.displayPrefix) ||
      !row.name.trim() ||
      row.name.length > 80 ||
      ![row.createdAt, row.expiresAt, row.revokedAt, row.lastUsedAt].every(
        (date) => date === null || Number.isFinite(date.getTime()),
      ) ||
      !Number.isInteger(row.rateRequestCount) ||
      row.rateRequestCount < 0 ||
      row.rateRequestCount > 60 ||
      (row.rateWindowStart === null
        ? row.rateRequestCount !== 0
        : !Number.isInteger(row.rateWindowStart) ||
          row.rateWindowStart % 60000 !== 0 ||
          row.rateRequestCount === 0) ||
      row.expiresAt.getTime() <= row.createdAt.getTime() ||
      row.expiresAt.getTime() - row.createdAt.getTime() > 7776000000 ||
      (row.revokedAt !== null && row.revokedAt < row.createdAt) ||
      (row.lastUsedAt !== null && row.lastUsedAt < row.createdAt)
    ) {
      return yield* new KeyStoreUnavailable()
    }

    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      name: row.name,
      environment,
      scopes,
      displayPrefix: row.displayPrefix,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    }
  })

const makePersonalAccessKeys = Effect.gen(function* () {
  const db = yield* Database
  const config = yield* ConfigService
  const clock = yield* Clock.Clock
  const crypto = yield* Crypto.Crypto

  const environment = Schema.decodeUnknownEffect(KeyEnvironment)(config.app.stage).pipe(
    Effect.mapError(() => new KeyStoreUnavailable()),
  )

  const digest = (token: Redacted.Redacted) =>
    crypto.digest('SHA-256', new TextEncoder().encode(Redacted.value(token))).pipe(
      Effect.orDie,
      Effect.map((bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')),
    )

  const owned = (ownerUserId: string, stage: string) =>
    and(eq(keys.ownerUserId, ownerUserId), eq(keys.environment, stage))

  const issue = Effect.fn('keys.issue')(function* (ownerUserId: string, input: IssueKeyInput) {
    const stage = yield* environment
    const now = yield* clock.currentTimeMillis

    const [owner] = yield* storage(() =>
      db.select().from(user).where(eq(user.id, ownerUserId)).limit(1),
    )

    if (
      !owner ||
      !canAuthorWithKey(owner.role) ||
      (owner.banned && (owner.banExpires === null || owner.banExpires.getTime() > now)) ||
      (input.scopes.includes('posts:publish') && !canPublishWithKey(owner.role))
    )
      return yield* new KeyAccessDenied()
    const name = input.name.trim()

    if (!name) return yield* new KeyInputInvalid()
    const id = yield* crypto.randomUUIDv4().pipe(Effect.orDie)
    const bytes = yield* crypto.randomBytes(32).pipe(Effect.orDie)

    const random = btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')

    const secret = Redacted.make(`gbfm_pat_v1_${stage}_${random}`)
    const hash = yield* digest(secret)
    const expiresAt = now + (input.expiresInSeconds ?? 2592000) * 1000
    const prefix = `gbfm_pat_v1_${stage}_${random.slice(0, 6)}`
    const scopes = JSON.stringify([...input.scopes].sort())

    const result = yield* storage(() =>
      db.run(sql`
      INSERT INTO personal_access_keys
        (id, owner_user_id, issuance_request_id, name, environment, scopes, secret_hash, display_prefix, created_at, expires_at)
      SELECT ${id}, ${ownerUserId}, ${input.requestId}, ${name}, ${stage}, ${scopes}, ${hash}, ${prefix}, ${now}, ${expiresAt}
      WHERE (SELECT count(*) FROM personal_access_keys WHERE owner_user_id = ${ownerUserId}
        AND environment = ${stage} AND revoked_at IS NULL AND expires_at > ${now}) < 10
      AND EXISTS (SELECT 1 FROM user WHERE id = ${ownerUserId} AND role = ${owner.role}
        AND (banned = 0 OR ban_expires <= ${now}))
      ON CONFLICT (owner_user_id, environment, issuance_request_id) DO NOTHING
    `),
    )

    if (!result.meta.changes) {
      const [existing] = yield* storage(() =>
        db
          .select({ id: keys.id })
          .from(keys)
          .where(and(owned(ownerUserId, stage), eq(keys.issuanceRequestId, input.requestId)))
          .limit(1),
      )

      if (existing) return yield* new KeyIssuanceConflict({ keyId: existing.id })

      return yield* new KeyLimitReached()
    }

    const [row] = yield* storage(() => db.select().from(keys).where(eq(keys.id, id)).limit(1))

    if (!row) return yield* new KeyStoreUnavailable()
    yield* Effect.logInfo('key.issued', { keyId: id, ownerUserId, environment: stage })

    return { key: yield* metadata(row), secret }
  })

  const list = Effect.fn('keys.list')(function* (
    ownerUserId: string,
    limit: number,
    offset: number,
  ) {
    const stage = yield* environment

    const rows = yield* storage(() =>
      db
        .select()
        .from(keys)
        .where(owned(ownerUserId, stage))
        .orderBy(desc(keys.createdAt), desc(keys.id))
        .limit(limit)
        .offset(offset),
    )

    const [total] = yield* storage(() =>
      db.select({ value: count() }).from(keys).where(owned(ownerUserId, stage)),
    )

    if (!total) return yield* new KeyStoreUnavailable()

    return {
      data: yield* Effect.forEach(rows, metadata),
      pagination: {
        total: total.value,
        limit,
        offset,
        hasMore: offset + rows.length < total.value,
      },
    }
  })

  const revoke = Effect.fn('keys.revoke')(function* (ownerUserId: string, keyId: string) {
    const stage = yield* environment
    const now = yield* clock.currentTimeMillis

    const rows = yield* storage(() =>
      db
        .update(keys)
        .set({ revokedAt: sql`coalesce(${keys.revokedAt}, ${now})` })
        .where(and(owned(ownerUserId, stage), eq(keys.id, keyId)))
        .returning({ id: keys.id }),
    )

    if (!rows.length) return yield* new HttpApiError.NotFound()

    return yield* Effect.logInfo('key.revoked', { keyId, ownerUserId, environment: stage })
  })

  const authenticate = Effect.fn('keys.authenticate')(function* (
    token: Redacted.Redacted,
  ): Effect.fn.Return<
    PersonalAccessKeyActor,
    InvalidKeyCredential | KeyStoreUnavailable | KeyRateLimited
  > {
    const stage = yield* environment
    const raw = Redacted.value(token)

    if (!new RegExp(`^gbfm_pat_v1_${stage}_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$`).test(raw))
      return yield* new InvalidKeyCredential()
    const hash = yield* digest(token)
    const now = yield* clock.currentTimeMillis
    const window = Math.floor(now / 60000) * 60000

    const [found] = yield* storage(() =>
      db
        .select({ key: keys, owner: user })
        .from(keys)
        .innerJoin(user, eq(user.id, keys.ownerUserId))
        .where(and(eq(keys.secretHash, hash), eq(keys.environment, stage)))
        .limit(1),
    )

    if (
      !found ||
      found.key.revokedAt ||
      found.key.expiresAt.getTime() <= now ||
      (found.owner.banned &&
        (found.owner.banExpires === null || found.owner.banExpires.getTime() > now))
    )
      return yield* new InvalidKeyCredential()
    const projection = yield* metadata(found.key)

    if (found.key.rateWindowStart !== null && found.key.rateWindowStart > window)
      return yield* new KeyStoreUnavailable()

    const rows = yield* storage(() =>
      db
        .update(keys)
        .set({
          rateWindowStart: window,
          rateRequestCount: sql`CASE WHEN ${keys.rateWindowStart} = ${window} THEN ${keys.rateRequestCount} + 1 ELSE 1 END`,
          lastUsedAt: new Date(now),
        })
        .where(
          and(
            eq(keys.id, found.key.id),
            isNull(keys.revokedAt),
            gt(keys.expiresAt, new Date(now)),
            or(
              isNull(keys.rateWindowStart),
              lt(keys.rateWindowStart, window),
              and(eq(keys.rateWindowStart, window), lt(keys.rateRequestCount, 60)),
            ),
            sql`EXISTS (SELECT 1 FROM user WHERE id = ${found.owner.id} AND role = ${found.owner.role} AND (banned = 0 OR ban_expires <= ${now}))`,
          ),
        )
        .returning({ id: keys.id }),
    )

    if (!rows.length) {
      const [current] = yield* storage(() =>
        db
          .select({ key: keys, owner: user })
          .from(keys)
          .innerJoin(user, eq(user.id, keys.ownerUserId))
          .where(eq(keys.id, found.key.id))
          .limit(1),
      )

      if (
        !current ||
        current.key.revokedAt ||
        current.key.expiresAt.getTime() <= now ||
        current.owner.role !== found.owner.role ||
        (current.owner.banned &&
          (current.owner.banExpires === null || current.owner.banExpires.getTime() > now))
      )
        return yield* new InvalidKeyCredential()

      return yield* new KeyRateLimited({
        retryAfterSeconds: Math.max(1, Math.ceil((window + 60000 - now) / 1000)),
      })
    }

    return {
      user: found.owner,
      credential: Credential.PersonalAccessKey({
        keyId: found.key.id,
        environment: stage,
        scopes: projection.scopes,
      }),
    }
  })

  return { issue, list, revoke, authenticate }
})

export class PersonalAccessKeys extends Context.Service<
  PersonalAccessKeys,
  Effect.Success<typeof makePersonalAccessKeys>
>()('PersonalAccessKeys') {}

export const PersonalAccessKeysLive = Layer.effect(PersonalAccessKeys, makePersonalAccessKeys)
