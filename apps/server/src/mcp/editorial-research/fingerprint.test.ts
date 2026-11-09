import { createHash } from 'node:crypto'

import { Effect } from 'effect'
import { expect, test } from 'vitest'

import { canonicalEvidenceJson, evidenceFingerprint } from './fingerprint'

test('canonical fingerprints use code-point keys, exact Unicode and array order', async () => {
  const canonical = '{"10":"ten","2":"two","a":[2,1],"é":"é","":1,"𐀀":2}'
  const value = { 𐀀: 2, '': 1, a: [2, 1], é: 'é', '2': 'two', '10': 'ten' }
  expect(canonicalEvidenceJson(value)).toBe(canonical)
  const expected = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
  expect(await Effect.runPromise(evidenceFingerprint(value))).toBe(expected)
  expect(await Effect.runPromise(evidenceFingerprint({ a: 'é' }))).not.toBe(
    await Effect.runPromise(evidenceFingerprint({ a: 'é' })),
  )
})
