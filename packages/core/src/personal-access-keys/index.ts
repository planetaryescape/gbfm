import { Schema } from 'effect'

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

export const canAuthorWithKey = (role: string | null | undefined) =>
  role === 'creator' || role === 'editor' || role === 'admin'

export const canPublishWithKey = (role: string | null | undefined) =>
  role === 'editor' || role === 'admin'

export const requiresPublishScope = (currentDraft: boolean | undefined, nextDraft: boolean) =>
  currentDraft === false || !nextDraft
