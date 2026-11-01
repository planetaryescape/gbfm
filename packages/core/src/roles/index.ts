import { Schema } from 'effect'

export const ROLES = ['user', 'creator', 'editor', 'admin'] as const

/** A recognized application role, parsed from an auth or persistence boundary. */
export const Role = Schema.Literals(ROLES).pipe(Schema.brand('Role'))

export type Role = typeof Role.Type

const roleRank = {
  user: 0,
  creator: 1,
  editor: 2,
  admin: 3,
} satisfies Record<(typeof ROLES)[number], number>

export const isRole = (value: string): value is Role => Schema.is(Role)(value)

const ranks = new Map<string, number>(Object.entries(roleRank))

export function hasMinRole(
  userRole: string | null | undefined,
  minRole: (typeof ROLES)[number],
): boolean {
  if (!userRole || !isRole(userRole)) return false

  return (ranks.get(userRole) ?? -1) >= roleRank[minRole]
}

export const canCreatePosts = (userRole: string | null | undefined): boolean =>
  hasMinRole(userRole, 'creator')
