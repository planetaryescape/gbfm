import type { Actor } from '@gbfm/api/middleware/actor'
import { KeyAccessDenied, KeyInputInvalid } from '@gbfm/api/personal-access-keys'
import {
  canAuthorWithKey,
  canPublishWithKey,
  requiresPublishScope,
  type KeyScope,
} from '@gbfm/core/personal-access-keys'
import { Effect, Predicate } from 'effect'

import type { MediaActor } from '@/services/media-publication'

export const requireKeyScope = (actor: Actor, scopes: ReadonlyArray<KeyScope>) => {
  if (Predicate.isTagged(actor.credential, 'Session')) return Effect.void
  const granted = actor.credential.scopes

  return canAuthorWithKey(actor.user.role) && scopes.some((scope) => granted.includes(scope))
    ? Effect.void
    : Effect.fail(new KeyAccessDenied())
}

export const authorizeKeyPostWrite = (
  actor: MediaActor | undefined,
  operation: 'posts:create' | 'posts:update',
  input: {
    readonly draft?: boolean | undefined
    readonly slug?: string | undefined
    readonly creatorIds?: ReadonlyArray<string> | undefined
  },
  currentDraft?: boolean,
) =>
  Effect.gen(function* () {
    if (actor?.credential?._tag !== 'PersonalAccessKey') return yield* Effect.void
    const scopes = actor.credential.scopes

    if (
      !canAuthorWithKey(actor.userRole) ||
      !scopes.includes(operation) ||
      (requiresPublishScope(currentDraft, input.draft ?? currentDraft ?? false) &&
        (!scopes.includes('posts:publish') || !canPublishWithKey(actor.userRole)))
    )
      return yield* new KeyAccessDenied()

    if (
      operation === 'posts:create' &&
      (!input.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug))
    )
      return yield* new KeyInputInvalid()

    if (
      input.creatorIds !== undefined &&
      (operation === 'posts:update' ||
        input.creatorIds.length !== 1 ||
        input.creatorIds[0] !== actor.userId)
    )
      return yield* new KeyAccessDenied()

    return yield* Effect.void
  })
