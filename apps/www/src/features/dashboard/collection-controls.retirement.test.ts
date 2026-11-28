import { Locator, Scene, Story, TestHost } from '@effect/ui/testing'
import { Deferred, Effect, Layer, Predicate, Schema } from 'effect'
import { expect, it } from 'vitest'

import { RoutedApplicationNoDeps } from '../../app/routed-application'
import { runWithLayer } from '../player/testing'
import { CollectionMessage, DashboardCollectionNoDeps, RemoveSavedItem } from './collection'
import { type DashboardDocument, emptyDocument } from './document'
import { dashboardRootFixture } from './page-root.test-support'
import { parseDashboardDocument } from './projection'
import {
  DashboardRequestError,
  DashboardService,
  ReadDashboard,
  makeDashboardServiceLayer,
  type DashboardRequest,
} from './service'

const principal = { id: 'listener', name: null, username: null, role: 'user' }

const decodeRemovalBody = Schema.decodeUnknownEffect(
  Schema.Struct({ expectedRevision: Schema.Number, requestId: Schema.String }),
)

it.each([409, 410])(
  'a real refused removal %s requires refresh and allocates a new request ID at the new revision',
  async (status) => {
    const writes: Array<DashboardRequest> = []
    let revision = 5

    const document = (): DashboardDocument => ({
      ...emptyDocument,
      rows: [
        {
          id: 'saved',
          title: 'Fixture',
          detail: '',
          href: null,
          actionId: 'item',
          membershipRevision: revision,
        },
      ],
    })

    const service = Layer.succeed(DashboardService, {
      request: (request: DashboardRequest) => {
        if (request.method !== 'DELETE') return Effect.succeed(document())
        writes.push(request)

        return writes.length === 1
          ? Effect.fail(new DashboardRequestError({ status, message: 'Refused' }))
          : Effect.succeed(emptyDocument)
      },
      readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
      writePlayerPreferences: () => Effect.void,
    })

    await runWithLayer(
      Layer.merge(
        TestHost.layer(),
        Layer.mergeAll(ReadDashboard.layer, RemoveSavedItem.layer).pipe(Layer.provide(service)),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(DashboardCollectionNoDeps, {
          principal,
          section: 'favorites',
          url: '/dashboard/favorites',
          initialDocument: document(),
        })

        root.send(CollectionMessage.ClickedRemove({ id: 'saved' }))
        yield* TestHost.settle
        expect(root.model()?.pending).toBeNull()
        expect(root.model()?.error).toContain(status === 409 ? 'changed' : 'expired')
        root.send(CollectionMessage.ClickedRemove({ id: 'saved' }))
        yield* TestHost.settle
        expect(writes).toHaveLength(1)
        revision = 6
        root.send(CollectionMessage.ClickedRefresh())
        yield* TestHost.settle
        expect(writes).toHaveLength(1)
        root.send(CollectionMessage.ClickedRemove({ id: 'saved' }))
        yield* TestHost.settle
        expect(writes).toHaveLength(2)

        const first = yield* decodeRemovalBody(JSON.parse(writes[0]?.body ?? 'null'))
        const second = yield* decodeRemovalBody(JSON.parse(writes[1]?.body ?? 'null'))
        expect(first.expectedRevision).toBe(5)
        expect(second.expectedRevision).toBe(6)
        expect(second.requestId).not.toBe(first.requestId)
        expect(root.model()?.pending).toBeNull()
      }),
    )
  },
)

it.each(['audio', 'show', 'reminder'])(
  '%s removal uses the native JSON DELETE transport and retries identical bytes',
  async (kind) => {
    const requests: Array<Request> = []
    const bodies: Array<string> = []

    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      bodies.push(await request.text())

      if (requests.length === 1) throw new TypeError('Response lost after commit')

      if (request.method === 'DELETE') return new Response(null, { status: 204 })

      return Response.json({ favorites: [], reminders: [], total: 0, success: true })
    }

    const section = kind === 'reminder' ? 'reminders' : 'favorites'

    const path =
      kind === 'reminder'
        ? '/api/music-reminders/item'
        : `/api/favorites/${kind === 'show' ? 'show/' : ''}item`

    await runWithLayer(
      Layer.merge(
        TestHost.layer(),
        Layer.mergeAll(ReadDashboard.layer, RemoveSavedItem.layer).pipe(
          Layer.provide(makeDashboardServiceLayer(fetcher)),
        ),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(DashboardCollectionNoDeps, {
          principal,
          section,
          url: `/dashboard/${section}`,
          initialDocument: {
            ...emptyDocument,
            rows: [
              {
                id: 'saved',
                title: 'Fixture',
                detail: '',
                href: null,
                actionId: kind === 'show' ? 'show/item' : 'item',
                membershipRevision: 27,
                commandRevision: 3,
              },
            ],
          },
        })

        root.send(CollectionMessage.ClickedRemove({ id: 'saved' }))
        yield* TestHost.settle
        expect(requests[0]?.url).toBe(`http://localhost${path}`)
        expect(requests[0]?.method).toBe('DELETE')
        expect(requests[0]?.headers.get('content-type')).toBe('application/json')
        expect(JSON.parse(bodies[0] ?? 'null')).toEqual({
          expectedRevision: kind === 'reminder' ? 3 : 27,
          requestId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
        })
        root.send(CollectionMessage.ClickedRemove({ id: 'saved' }))
        yield* TestHost.settle
        expect(requests[1]?.url).toBe(requests[0]?.url)
        expect(requests[1]?.method).toBe('DELETE')
        expect(requests[1]?.headers.get('content-type')).toBe('application/json')
        expect(bodies[1]).toBe(bodies[0])
        expect(root.model()?.pending).toBeNull()
      }),
    )
  },
)

it('successful empty and populated reminder query results retain their exact readable fields', () => {
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const props = {
          principal,
          section: 'reminders',
          url: '/dashboard/reminders',
          initialDocument: emptyDocument,
        }

        const scene = yield* Scene.make(DashboardCollectionNoDeps, props)
        const story = yield* Story.make(DashboardCollectionNoDeps, props)
        story.send(CollectionMessage.ClickedRefresh()).loaded('document', emptyDocument)
        expect(story.model.error).toBeNull()

        const document: DashboardDocument = {
          ...emptyDocument,
          rows: [{ id: 'r1', title: 'Album', detail: 'Artist', href: null, actionId: 'r1' }],
        }

        scene.given(story.model, { document })
        expect(scene.current.query(Locator.text('Album', { exact: true }))).toBeDefined()
        expect(scene.current.query(Locator.text('Artist', { exact: true }))).toBeDefined()
      }),
    ),
  )
})

it.each(['audio', 'show', 'reminder'])(
  '%s removal renders disabled pending control, enabled refreshed retry and identical intent',
  async (kind) => {
    const section = kind === 'reminder' ? 'reminders' : 'favorites'

    const initial: DashboardDocument = {
      ...emptyDocument,
      rows: [
        {
          id: 'saved',
          title: 'Fixture',
          detail: '',
          href: null,
          actionId: kind === 'show' ? 'show/item' : 'item',
          membershipRevision: 27,
          commandRevision: 3,
        },
      ],
    }

    let current = initial
    const gate = Deferred.makeUnsafe<DashboardDocument, DashboardRequestError>()
    const writes: Array<DashboardRequest> = []

    const service = Layer.succeed(DashboardService, {
      request: (request: DashboardRequest) => {
        if (request.method !== 'DELETE') return Effect.succeed(current)
        writes.push(request)

        return writes.length === 1 ? Deferred.await(gate) : Effect.succeed(emptyDocument)
      },
      readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
      writePlayerPreferences: () => Effect.void,
    })

    await runWithLayer(
      Layer.merge(
        TestHost.layer(),
        Layer.mergeAll(ReadDashboard.layer, RemoveSavedItem.layer).pipe(Layer.provide(service)),
      ),
      Effect.gen(function* () {
        const root = yield* TestHost.mount(DashboardCollectionNoDeps, {
          principal,
          section,
          url: `/dashboard/${section}`,
          initialDocument: initial,
        })

        const control = (label: string) => {
          const node = root.get(Locator.text(label, { exact: true }))

          if (!Predicate.isTagged(node, 'Element')) throw new Error(`Missing ${label} control`)
          expect(node.tag).toBe('button')

          return node
        }

        Locator.fire(control('Remove'), 'click')
        yield* TestHost.settle
        expect(control('Remove').attrs.disabled).toBeDefined()
        root.send(CollectionMessage.ClickedRemove({ id: 'saved' }))
        yield* TestHost.settle
        expect(writes).toHaveLength(1)
        yield* Deferred.fail(
          gate,
          new DashboardRequestError({ status: null, message: 'Acknowledgement lost' }),
        )
        yield* TestHost.settle
        expect(control('Retry removal').attrs.disabled).toBeUndefined()
        current = {
          ...initial,
          rows: initial.rows.map((row) => ({
            ...row,
            membershipRevision: 38,
            commandRevision: 14,
          })),
        }
        root.send(CollectionMessage.ClickedRefresh())
        yield* TestHost.settle
        expect(control('Retry removal').attrs.disabled).toBeUndefined()
        current = emptyDocument
        root.send(CollectionMessage.ClickedRefresh())
        yield* TestHost.settle
        expect(root.text()).toContain('Nothing here yet.')
        expect(control('Retry pending removal').attrs.disabled).toBeUndefined()
        Locator.fire(control('Retry pending removal'), 'click')
        yield* TestHost.settle
        expect(writes).toHaveLength(2)
        expect(writes[1]).toEqual(writes[0])
        expect(JSON.parse(writes[0]?.body ?? 'null')).toMatchObject({
          expectedRevision: kind === 'reminder' ? 3 : 27,
          requestId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
        })
        expect(root.model()?.pending).toBeNull()
        expect(root.query(Locator.text('Retry pending removal', { exact: true }))).toBeUndefined()
      }),
    )
  },
)

it('a cancelled reminder row still exposes its enabled retry for the original uncertain removal', async () => {
  const initial: DashboardDocument = {
    ...emptyDocument,
    rows: [
      {
        id: 'item',
        title: 'Fixture',
        detail: '',
        href: null,
        actionId: 'item',
        commandRevision: 3,
      },
    ],
  }

  const cancelled = await Effect.runPromise(
    parseDashboardDocument('/api/music-reminders', {
      success: true,
      total: 1,
      reminders: [
        {
          id: 'item',
          userId: principal.id,
          musicTitle: 'Fixture',
          artistName: 'Artist',
          musicUrl: 'https://example.test/music',
          albumCoverUrl: null,
          reminderDate: '2026-11-12T10:00:00Z',
          notes: null,
          status: 'pending',
          isSent: false,
          commandRevision: 14,
          dispatchState: 'cancelled',
          createdAt: '2026-11-09T10:00:00Z',
          updatedAt: '2026-11-09T10:00:00Z',
        },
      ],
    }),
  )

  const requests: Array<DashboardRequest> = []

  const service = Layer.succeed(DashboardService, {
    request: (request: DashboardRequest) => {
      requests.push(request)

      return request.method === 'DELETE'
        ? Effect.fail(new DashboardRequestError({ status: null, message: 'Acknowledgement lost' }))
        : Effect.succeed(cancelled)
    },
    readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
    writePlayerPreferences: () => Effect.void,
  })

  await runWithLayer(
    Layer.merge(
      TestHost.layer(),
      Layer.mergeAll(ReadDashboard.layer, RemoveSavedItem.layer).pipe(Layer.provide(service)),
    ),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(DashboardCollectionNoDeps, {
        principal,
        section: 'reminders',
        url: '/dashboard/reminders',
        initialDocument: initial,
      })

      root.send(CollectionMessage.ClickedRemove({ id: 'item' }))
      yield* TestHost.settle
      root.send(CollectionMessage.ClickedRefresh())
      yield* TestHost.settle
      expect(root.text()).toContain('Cancelled')
      expect(root.model()?.pending?.expectedRevision).toBe(3)
      const retry = root.query(Locator.text('Retry removal', { exact: true }))
      expect(retry, 'cancelled row must not hide its outstanding removal retry').toBeDefined()

      if (!Predicate.isTagged(retry, 'Element'))
        throw new Error('Missing enabled cancellation retry')
      expect(retry.attrs.disabled).toBeUndefined()
      expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1)
      Locator.fire(retry, 'click')
      yield* TestHost.settle
      const writes = requests.filter((request) => request.method === 'DELETE')
      expect(writes).toHaveLength(2)
      expect(writes[1]).toEqual(writes[0])
    }),
  )
})

it('a fresh non-actionable reminder has neither a removal control nor a forged removal request', async () => {
  const requests: Array<DashboardRequest> = []

  const document: DashboardDocument = {
    ...emptyDocument,
    rows: [
      {
        id: 'cancelled',
        title: 'Cancelled reminder',
        detail: 'Cancelled',
        href: null,
        actionId: null,
        commandRevision: 14,
      },
    ],
  }

  const service = Layer.succeed(DashboardService, {
    request: (request: DashboardRequest) => {
      requests.push(request)

      return Effect.succeed(document)
    },
    readPlayerPreferences: Effect.succeed({ continueQueue: true, restorePosition: true }),
    writePlayerPreferences: () => Effect.void,
  })

  await runWithLayer(
    Layer.merge(
      TestHost.layer(),
      Layer.mergeAll(ReadDashboard.layer, RemoveSavedItem.layer).pipe(Layer.provide(service)),
    ),
    Effect.gen(function* () {
      const root = yield* TestHost.mount(DashboardCollectionNoDeps, {
        principal,
        section: 'reminders',
        url: '/dashboard/reminders',
        initialDocument: document,
      })

      expect(root.query(Locator.text('Remove', { exact: true }))).toBeUndefined()
      expect(root.query(Locator.text('Retry removal', { exact: true }))).toBeUndefined()
      expect(root.query(Locator.text('Retry pending removal', { exact: true }))).toBeUndefined()
      root.send(CollectionMessage.ClickedRemove({ id: 'cancelled' }))
      yield* TestHost.settle
      expect(requests).toEqual([])
      expect(root.model()?.pending).toBeNull()
    }),
  )
})

it.each(['user', 'creator', 'editor'])(
  '%s mounted denied admin page performs zero administrator API requests',
  async (role) => {
    const fixture = dashboardRootFixture('/dashboard/users', {
      principal: { id: 'denied', name: null, username: null, role },
      principalKnown: true,
      status: 200,
      failure: null,
      dashboard: emptyDocument,
    })

    await runWithLayer(
      fixture.layer,
      Effect.gen(function* () {
        const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
        yield* TestHost.settle
        expect(root.text()).toContain('Administrator access required')
        expect(fixture.apiRequests).toEqual([])
        expect(fixture.requests).toHaveLength(1)
      }),
    )
  },
)
