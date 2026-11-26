import { Layer } from 'effect'
import { Digest, SecureRandom } from 'effect/crypto'

/**
 * Platform-agnostic `Crypto` layer backed by the global WebCrypto API.
 * Works on Bun, Node >= 19, browsers, and edge runtimes.
 *
 * Digest failures are defects: the algorithms we request are constant and
 * always supported by WebCrypto, so there is no recoverable error to model.
 */
export const CryptoLive = Layer.mergeAll(Digest.layerWebCrypto, SecureRandom.layerWebCrypto)
