import { Schema } from 'effect'
import { expect, test } from 'vitest'

import { isRole, Role } from '../roles'
import {
  canAuthorWithKey,
  canPublishWithKey,
  KeyName,
  KeyScopes,
  requiresPublishScope,
} from './index'

test('key labels count trimmed Unicode code points and reject every control range', () => {
  for (const name of ['  valid label  ', ` ${'🎵'.repeat(80)} `])
    expect(Schema.is(KeyName)(name)).toBe(true)

  for (const name of [
    '',
    '   ',
    '🎵'.repeat(81),
    'a\u0000b',
    'a\u001fb',
    'a\u007fb',
    'a\u0085b',
    'a\u009fb',
  ])
    expect(Schema.is(KeyName)(name)).toBe(false)
})

test('key author and publication authority use the current branded role', () => {
  for (const [name, author, publish] of [
    ['user', false, false],
    ['creator', true, false],
    ['editor', true, true],
    ['admin', true, true],
  ] as const) {
    const role = Schema.decodeUnknownSync(Role)(name)
    expect(canAuthorWithKey(role)).toBe(author)
    expect(canPublishWithKey(role)).toBe(publish)
    const external: string = name

    const refined = isRole(external) ? external : undefined
    expect(canAuthorWithKey(refined)).toBe(author)
  }

  expect(canAuthorWithKey(null)).toBe(false)
  expect(canPublishWithKey(undefined)).toBe(false)
  expect(isRole('superuser')).toBe(false)
})

test('only draft-to-draft writes avoid publication scope, including default-public creates', () => {
  for (const [current, next, required] of [
    [undefined, true, false],
    [undefined, false, true],
    [true, true, false],
    [true, false, true],
    [false, false, true],
    [false, true, true],
  ] as const)
    expect(requiresPublishScope(current, next)).toBe(required)
})

test('scopes are closed, nonempty and unique; publication depends on a write scope', () => {
  for (const scopes of [
    ['posts:read'],
    ['posts:create', 'posts:publish'],
    ['posts:update', 'posts:publish'],
  ])
    expect(Schema.is(KeyScopes)(scopes)).toBe(true)

  for (const scopes of [
    [],
    ['posts:publish'],
    ['posts:read', 'posts:publish'],
    ['posts:read', 'posts:read'],
    ['music:resolve'],
    ['uploads:images:create'],
  ])
    expect(Schema.is(KeyScopes)(scopes)).toBe(false)
})
