import { Schema } from 'effect'

import type { Role } from '../roles'

/** The server-generated UUID identity of a personal access key. */
export const KeyId = Schema.String.pipe(Schema.check(Schema.isUUID(4)), Schema.brand('KeyId'))

export type KeyId = typeof KeyId.Type

/** A client-generated UUID identifying one issuance attempt. */
export const KeyIssuanceId = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  ),
  Schema.brand('KeyIssuanceId'),
)

/** A nonblank key label without control characters, bounded for display and storage. */
export const KeyName = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((name) => {
      const length = Array.from(name.trim()).length

      return length >= 1 && length <= 80 && !/\p{Cc}/u.test(name)
    }),
  ),
  Schema.brand('KeyName'),
)

/** The canonical UTC timestamp representation used in key metadata. */
export const KeyTimestamp = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => {
      const date = new Date(value)

      return Number.isFinite(date.getTime()) && date.toISOString() === value
    }),
  ),
  Schema.brand('KeyTimestamp'),
)

/** A display-only token prefix, never an authentication credential. */
export const KeyDisplayPrefix = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^gbfm_pat_v1_(?:dev|prod)_[A-Za-z0-9_-]{6}$/)),
  Schema.brand('KeyDisplayPrefix'),
)

export const KeyScope = Schema.Literals([
  'posts:read',
  'posts:create',
  'posts:update',
  'posts:publish',
])

export type KeyScope = typeof KeyScope.Type

export const KeyEnvironment = Schema.Literals(['dev', 'prod'])

export type KeyEnvironment = typeof KeyEnvironment.Type

export const KeyScopes = Schema.Array(KeyScope).pipe(
  Schema.check(
    Schema.makeFilter(
      (scopes) =>
        scopes.length > 0 &&
        new Set(scopes).size === scopes.length &&
        (!scopes.includes('posts:publish') ||
          scopes.includes('posts:create') ||
          scopes.includes('posts:update')),
    ),
  ),
)

export const canAuthorWithKey = (role: Role | null | undefined) =>
  role === 'creator' || role === 'editor' || role === 'admin'

export const canPublishWithKey = (role: Role | null | undefined) =>
  role === 'editor' || role === 'admin'

export const requiresPublishScope = (currentDraft: boolean | undefined, nextDraft: boolean) =>
  currentDraft === false || !nextDraft
