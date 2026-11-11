import { Effect, Result } from 'effect'

import {
  fetchImportMusicArtwork,
  MusicCoverImageFetcher,
} from '@/services/canonical-music-identity/artwork-delivery'

export default {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fetcher = yield* MusicCoverImageFetcher

        return yield* fetchImportMusicArtwork(
          fetcher,
          `https://i.scdn.co${path}`,
          new URL('https://artwork.example.test/user-content/music/album/disposable/'),
        )
      }).pipe(Effect.result),
    )

    if (Result.isFailure(result))
      return Response.json({ status: 'unavailable', reason: result.failure.reason })

    if (!result.success) return Response.json({ status: 'rejected' })

    return Response.json({
      status: 'fetched',
      contentType: result.success.contentType,
      byteLength: result.success.bytes.byteLength,
    })
  },
}
