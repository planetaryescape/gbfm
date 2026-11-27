import { Context, Effect, Layer, Predicate } from 'effect'
import { describe, expect, it } from 'vitest'

import { catalogWriter } from './catalog'
import { emptyDocument } from './document'
import { DashboardService, makeDashboardServiceLayer } from './service'

describe('legacy dashboard transport parity through native services', () => {
  it('preserves explicit empty artist values and clears an empty genres list', async () => {
    const bodies: Array<string> = []

    const fetcher: typeof fetch = async (input, init) => {
      bodies.push(await new Request(input, init).text())

      return new Response(null, { status: 204 })
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(makeDashboardServiceLayer(fetcher))
        const write = yield* catalogWriter.pipe(Effect.provideContext(context))

        const result = yield* write({
          action: 'save',
          kind: 'artist',
          id: 'artist',
          linkId: '',
          expectedRevision: 8,
          requestId: '6da42445-0ad9-4df5-aeb4-4c20d2cd440c',
          references: [],
          fields: { name: 'Artist', slug: 'artist', genres: '' },
        })

        expect(Predicate.isTagged(result, 'SucceededWrite')).toBe(true)
      }).pipe(Effect.scoped),
    )
    expect(bodies).toHaveLength(1)
    expect(JSON.parse(bodies[0] ?? 'null')).toEqual({
      name: 'Artist',
      slug: 'artist',
      bio: '',
      imageUrl: '',
      genres: [],
      publishedAt: '',
      expectedRevision: 8,
      requestId: '6da42445-0ad9-4df5-aeb4-4c20d2cd440c',
      references: [],
    })
  })

  it('sends authenticated uncached same-origin reads and projects an empty collection', async () => {
    const requests: Array<{
      url: string
      credentials: RequestCredentials | undefined
      cache: RequestCache | undefined
    }> = []

    const fetcher: typeof fetch = async (input, init) => {
      requests.push({
        url: new Request(input, init).url,
        credentials: init?.credentials,
        cache: init?.cache,
      })

      return Response.json({ favorites: [], success: true, total: 0 })
    }

    const document = await Effect.runPromise(
      Effect.gen(function* () {
        const service = Context.get(
          yield* Layer.build(makeDashboardServiceLayer(fetcher)),
          DashboardService,
        )

        return yield* service.request({ path: '/api/favorites' })
      }).pipe(Effect.scoped),
    )

    expect(document).toEqual(emptyDocument)
    expect(requests).toEqual([
      { url: 'http://localhost/api/favorites', credentials: 'include', cache: 'no-store' },
    ])
  })

  it('rejects malformed favorite success bodies instead of reporting an empty list', async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const service = Context.get(
          yield* Layer.build(
            makeDashboardServiceLayer(async () =>
              Response.json({ favorites: 'invalid', success: true, total: 1 }),
            ),
          ),
          DashboardService,
        )

        return yield* service.request({ path: '/api/favorites' }).pipe(Effect.flip)
      }).pipe(Effect.scoped),
    )

    expect(error.message).toBe('Invalid dashboard response.')
  })

  it('preserves successful imports despite unavailable enrichment and rejects malformed link-sync acknowledgements', async () => {
    const imported = {
      status: 'Imported',
      playlistId: 'p1',
      trackCount: 9,
      createdTrackCount: 2,
      reusedTrackCount: 7,
      enrichmentStatus: 'Unavailable',
    }

    const fetcher: typeof fetch = async (input) =>
      Response.json(
        new Request(input).url.endsWith('/import/spotify') ? imported : { status: 'Completed' },
      )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = Context.get(
          yield* Layer.build(makeDashboardServiceLayer(fetcher)),
          DashboardService,
        )

        const document = yield* service.request({
          path: '/api/music/playlists/import/spotify',
          method: 'POST',
          body: '{}',
        })

        const error = yield* service
          .request({ path: '/api/music/playlists/p1/sync-links', method: 'POST' })
          .pipe(Effect.flip)

        return { document, error }
      }).pipe(Effect.scoped),
    )

    expect(result.document.playlistImport).toEqual(imported)
    expect(result.error.message).toBe('Invalid dashboard response.')
  })

  it('sends only owned track fields, ordered artist names, parsed numbers and explicit clearing values', async () => {
    const bodies: Array<string> = []

    const fetcher: typeof fetch = async (input, init) => {
      bodies.push(await new Request(input, init).text())

      return new Response(null, { status: 204 })
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(makeDashboardServiceLayer(fetcher))
        const write = yield* catalogWriter.pipe(Effect.provideContext(context))

        const result = yield* write({
          action: 'save',
          kind: 'track',
          id: 'track',
          linkId: '',
          expectedRevision: 8,
          requestId: '6da42445-0ad9-4df5-aeb4-4c20d2cd440c',
          references: [],
          fields: {
            title: ' Track ',
            slug: 'track',
            artistNames: 'Second, First',
            trackNumber: '7',
            albumId: '',
            publishedAt: '',
            createdById: 'forged-owner',
          },
        })

        expect(Predicate.isTagged(result, 'SucceededWrite')).toBe(true)

        const invalid = yield* write({
          action: 'save',
          kind: 'track',
          id: 'track',
          linkId: '',
          expectedRevision: 8,
          requestId: '6da42445-0ad9-4df5-aeb4-4c20d2cd440c',
          references: [],
          fields: { trackNumber: 'not a number' },
        })

        expect(Predicate.isTagged(invalid, 'FailedWrite')).toBe(true)
      }).pipe(Effect.scoped),
    )
    expect(bodies).toHaveLength(1)
    expect(JSON.parse(bodies[0] ?? 'null')).toEqual({
      title: 'Track',
      slug: 'track',
      artistNames: ['Second', 'First'],
      trackNumber: 7,
      albumId: null,
      coverImageUrl: null,
      publishedAt: null,
      expectedRevision: 8,
      requestId: '6da42445-0ad9-4df5-aeb4-4c20d2cd440c',
      references: [],
    })
  })
})
