import { Effect, type Schema } from 'effect'

import { EditorialToolError } from '../contracts'

/** Code-point order, including astral characters, is independent of locale/UTF-16 order. */
export const compareEvidenceKeys = (left: string, right: string): number => {
  const a = Array.from(left, (character) => character.codePointAt(0) ?? 0)
  const b = Array.from(right, (character) => character.codePointAt(0) ?? 0)

  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0)
  }

  return a.length - b.length
}

/** No normalization, omitted keys or native object-key reordering in canonical JSON. */
export const canonicalEvidenceJson = (value: Schema.Json): string => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This is serialization of an established JSON union, not parsing unknown input.
  if (value === null || typeof value !== 'object') return JSON.stringify(value)

  if (Array.isArray(value)) return `[${value.map(canonicalEvidenceJson).join(',')}]`

  return `{${Object.entries(value)
    .sort(([a], [b]) => compareEvidenceKeys(a, b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalEvidenceJson(entry)}`)
    .join(',')}}`
}

export const evidenceFingerprint = (value: Schema.Json) =>
  Effect.tryPromise({
    try: async () => {
      const bytes = new TextEncoder().encode(canonicalEvidenceJson(value))
      const digest = await crypto.subtle.digest('SHA-256', bytes)

      return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
    },
    catch: () => new EditorialToolError({ code: 'unavailable', message: 'Evidence unavailable.' }),
  })
