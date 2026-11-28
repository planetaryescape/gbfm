import { Effect } from 'effect'
import { Digest } from 'effect/crypto'
import { Hex } from 'effect/encoding'
import { expect, test } from 'vitest'

import { withTestLayer } from '@/test/effect'

import { CryptoLive } from './crypto'

test('WebCrypto SHA-256 preserves fixed digest vectors and byte-view boundaries', async () => {
  const padded = new TextEncoder().encode('!abc?')

  const vectors = [
    {
      input: new Uint8Array(),
      expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
    {
      input: new TextEncoder().encode('abc'),
      expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    },
    {
      input: padded.subarray(1, 4),
      expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    },
  ]

  await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const digest = yield* Digest.Digest

        for (const { input, expected } of vectors) {
          expect(Hex.encode(yield* digest.digest(Digest.sha256, input))).toBe(expected)
          expect(yield* digest.digestHex(Digest.sha256, input)).toBe(expected)
        }
      }),
      CryptoLive,
    ),
  )
})
