import { UpdateTrackInput } from '@gbfm/api/music'
import { Context, Effect, Exit, Layer, Predicate, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { catalogWriter } from './catalog'
import { DashboardService, makeDashboardServiceLayer } from './service'
import { makeSessionServiceLayer, SessionService } from './sessions'

describe('native dashboard HTTP seams', () => {
  it('submits the observed album reference with a track metadata revision', async () => {
    const sent: Array<typeof UpdateTrackInput.Type> = []

    const transport: typeof fetch = async (input, init) => {
      const request = new Request(input, init)
      sent.push(Schema.decodeUnknownSync(UpdateTrackInput)(await request.json()))

      return new Response(null, { status: 204 })
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(makeDashboardServiceLayer(transport))
        const write = yield* catalogWriter.pipe(Effect.provideContext(context))

        const result = yield* write({
          action: 'save',
          kind: 'track',
          id: 'track-1',
          linkId: '',
          expectedRevision: 8,
          requestId: '6da42445-0ad9-4df5-aeb4-4c20d2cd440c',
          fields: {
            title: 'Fixture track',
            slug: 'fixture-track',
            albumId: 'album-1',
            trackNumber: '1',
          },
          references: [{ entityType: 'album', entityId: 'album-1', expectedRevision: 3 }],
        })

        expect(Predicate.isTagged(result, 'SucceededWrite')).toBe(true)
      }).pipe(Effect.scoped),
    )
    expect(sent).toEqual([
      {
        title: 'Fixture track',
        slug: 'fixture-track',
        artistNames: [],
        coverImageUrl: null,
        albumId: 'album-1',
        trackNumber: 1,
        publishedAt: null,
        expectedRevision: 8,
        requestId: '6da42445-0ad9-4df5-aeb4-4c20d2cd440c',
        references: [{ entityType: 'album', entityId: 'album-1', expectedRevision: 3 }],
      },
    ])
  })
  it('reuses the exact music write intent after a lost acknowledgement', async () => {
    const writes: Array<{ readonly revision: string | null; readonly requestId: string | null }> =
      []

    const transport: typeof fetch = async (input, init) => {
      const request = new Request(input, init)
      writes.push({
        revision: request.headers.get('x-gbfm-music-revision'),
        requestId: request.headers.get('x-gbfm-request-id'),
      })

      return new Response(null, { status: writes.length === 1 ? 500 : 204 })
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(makeDashboardServiceLayer(transport))
        const write = yield* catalogWriter.pipe(Effect.provideContext(context))

        const result = yield* write({
          action: 'delete',
          kind: 'artist',
          id: 'artist-1',
          fields: { id: 'artist-1', revision: '8' },
          linkId: '',
          expectedRevision: 8,
          requestId: '6da42445-0ad9-4df5-aeb4-4c20d2cd440c',
          references: [],
        })

        expect(Predicate.isTagged(result, 'FailedWrite')).toBe(true)

        if (!Predicate.isTagged(result, 'FailedWrite')) return
        expect(result.uncertain).toBe(true)
        const retried = yield* write(result.pending)
        expect(Predicate.isTagged(retried, 'SucceededWrite')).toBe(true)
      }).pipe(Effect.scoped),
    )
    expect(writes).toEqual([
      { revision: '8', requestId: '6da42445-0ad9-4df5-aeb4-4c20d2cd440c' },
      { revision: '8', requestId: '6da42445-0ad9-4df5-aeb4-4c20d2cd440c' },
    ])
  })
  it('blocks cross-origin requests before invoking the transport', async () => {
    const requests: Array<string> = []

    const transport: typeof fetch = async (input) => {
      requests.push(new Request(input).url)

      return Response.json({})
    }

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const service = Context.get(
          yield* Layer.build(makeDashboardServiceLayer(transport)),
          DashboardService,
        )

        return yield* service.request({ path: 'https://not-gbfm.example/api/user/profile' })
      }).pipe(Effect.scoped, Effect.exit),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(requests).toEqual([])
  })

  it('decodes profile responses before projecting editable native state', async () => {
    const transport: typeof fetch = async () =>
      Response.json({
        id: 'listener',
        username: 'listener',
        name: 'Listener',
        email: 'listener@example.test',
        bio: 'About me',
        image: null,
        emailVerified: true,
        avatarUrl: null,
        verified: false,
        socialLinks: [],
      })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = Context.get(
          yield* Layer.build(makeDashboardServiceLayer(transport)),
          DashboardService,
        )

        return yield* service.request({ path: '/api/user/profile' })
      }).pipe(Effect.scoped),
    )

    expect(result).toEqual({
      rows: [],
      fields: { username: 'listener', email: 'listener@example.test', bio: 'About me' },
      toggles: {},
    })
  })

  it('rejects malformed projected responses without returning unparsed data', async () => {
    const transport: typeof fetch = async () => Response.json({ email: 42 })

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const service = Context.get(
          yield* Layer.build(makeDashboardServiceLayer(transport)),
          DashboardService,
        )

        return yield* service.request({ path: '/api/user/profile' })
      }).pipe(Effect.scoped, Effect.exit),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(exit)).not.toContain('42')
  })

  it('keeps bearer tokens inside the session adapter and validates session ownership on revoke', async () => {
    const writes: Array<{ readonly path: string; readonly body: string | undefined }> = []

    const transport: typeof fetch = async (input, init) => {
      const request = new Request(
        input instanceof Request ? input : new URL(input, 'http://localhost'),
        init,
      )

      const path = new URL(request.url).pathname
      writes.push({ path, body: request.method === 'GET' ? undefined : await request.text() })

      if (path.endsWith('list-user-sessions'))
        return Response.json({
          sessions: [
            {
              id: 'session-1',
              userId: 'listener',
              token: 'fixture-bearer-never-in-ui',
              createdAt: '2026-11-26T00:00:00.000Z',
              expiresAt: '2026-11-27T00:00:00.000Z',
              userAgent: 'Fixture browser',
              ipAddress: '127.0.0.1',
            },
          ],
        })

      return Response.json({})
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = Context.get(
          yield* Layer.build(makeSessionServiceLayer(transport)),
          SessionService,
        )

        const sessions = yield* service.list('listener')
        const denied = yield* service.revoke('someone-else', 'session-1').pipe(Effect.exit)
        yield* service.revoke('listener', 'session-1')
        const stale = yield* service.revoke('listener', 'session-1').pipe(Effect.exit)

        return { sessions, denied: Exit.isFailure(denied), stale: Exit.isFailure(stale) }
      }).pipe(Effect.scoped),
    )

    expect(JSON.stringify(result)).not.toContain('fixture-bearer-never-in-ui')
    expect(result.denied).toBe(true)
    expect(result.stale).toBe(true)
    expect(result.sessions).toEqual([
      {
        id: 'session-1',
        createdAt: '2026-11-26T00:00:00.000Z',
        expiresAt: '2026-11-27T00:00:00.000Z',
        userAgent: 'Fixture browser',
        ipAddress: '127.0.0.1',
      },
    ])
    expect(writes.filter((request) => request.path.endsWith('revoke-user-session'))).toEqual([
      {
        path: '/auth/admin/revoke-user-session',
        body: '{"sessionToken":"fixture-bearer-never-in-ui"}',
      },
    ])
  })
})
