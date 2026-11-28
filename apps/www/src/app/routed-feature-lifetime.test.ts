import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Exit, Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import { emptyDocument } from '../features/dashboard/document'
import { runWithLayer } from '../features/player/testing'
import {
  AppBootstrap,
  RoutedApplicationMessage,
  RoutedApplicationNoDeps,
} from './routed-application'
import {
  click,
  disabled,
  documents,
  fieldValue,
  input,
  requestFields,
  responseGate,
  routedLayer,
  submitCreator,
  type RequestFields,
  type RoutedRoot,
} from './routed-feature-lifetime.test-support'

type Mode = 'same-account' | 'other-account' | 'root-unmount'

const modes: ReadonlyArray<Mode> = ['same-account', 'other-account', 'root-unmount']

const reenter = Effect.fnUntraced(function* (
  fixture: ReturnType<typeof documents>,
  root: RoutedRoot,
  scope: Scope.Closeable,
  mode: Mode,
) {
  const router = yield* Router.Router
  const host = yield* TestHost.TestHost
  const account = mode === 'other-account' ? 'owner-b' : 'owner-a'
  fixture.account(account)

  if (mode === 'root-unmount') yield* Scope.close(scope, Exit.void)
  else {
    yield* router.navigate('/about')
    yield* TestHost.settle
  }

  const away = {
    text: root.text(),
    creator: root.query(Locator.attr('name', 'title')) !== undefined,
    dashboard: root.query(Locator.attr('name', 'username')) !== undefined,
  }

  const pending = fixture.holdNext()
  let fresh = root

  if (mode === 'root-unmount') {
    fresh = yield* TestHost.mount(
      RoutedApplicationNoDeps,
      AppBootstrap.make({
        ...fixture.props,
        identity: { principalId: account, known: true, epoch: 2 },
      }),
    )
  } else yield* router.navigate(`${fixture.props.url.pathname}${fixture.props.url.search}`)
  host.drain(10_000)
  yield* Effect.promise(() => pending.entered)

  const loading = {
    creator: fresh.query(Locator.attr('name', 'title')) !== undefined,
    dashboard: fresh.query(Locator.attr('name', 'username')) !== undefined,
    epoch: fresh.model()?.identity.epoch,
  }

  pending.resume()
  yield* TestHost.settle

  return { root: fresh, away, loading }
})

describe('native routed private feature lifetimes', () => {
  it.each(modes)(
    'drops an old Creator save after %s without applying it to a fresh pending save',
    async (mode) => {
      const fixture = documents('/new/tweet')
      const old = responseGate()
      const current = responseGate()
      const writes: Array<RequestFields> = []
      const accepted: Array<RequestFields> = []
      const oldPublished = Promise.withResolvers<void>()

      const fetch: typeof globalThis.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input, fixture.props.url)

        if (url.pathname === '/api/content/post' && init?.method === 'POST') {
          const payload = requestFields(init.body)
          writes.push(payload)
          const gate = writes.length === 1 ? old : current

          return gate.request(init.signal).then((response) => {
            if (response.ok) accepted.push(payload)

            if (gate === old) oldPublished.resolve()

            return response
          })
        }

        if (url.pathname === '/api/content/posts/preview')
          return Promise.resolve(Response.json({ richContent: { version: 1, blocks: [] } }))

        return Promise.reject(new Error(`Unexpected Creator request ${url.pathname}`))
      }

      await runWithLayer(
        routedLayer(fixture, fetch),
        Effect.gen(function* () {
          const host = yield* TestHost.TestHost
          const scope = yield* Scope.fork(yield* Scope.Scope)

          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props).pipe(
            Effect.provideService(Scope.Scope, scope),
          )

          yield* TestHost.settle
          input(root, 'title', 'Old account private writing')
          submitCreator(root)
          host.drain(10_000)
          expect(old.started()).toBe(true)
          yield* Effect.promise(() => old.entered)
          expect(writes).toHaveLength(1)
          expect(writes[0]).toMatchObject({
            title: 'Old account private writing',
            creatorIds: ['owner-a'],
          })

          const transition = yield* reenter(fixture, root, scope, mode)
          const fresh = transition.root
          expect(transition.away).toMatchObject({ creator: false, dashboard: false })
          expect(transition.away.text).not.toContain('Old account private writing')
          expect(transition.loading).toMatchObject({ creator: false, dashboard: false })
          expect(transition.loading.epoch).toBeGreaterThan(0)
          expect(old.aborted()).toBe(true)
          expect(fieldValue(fresh, 'title')).toBe('')
          input(fresh, 'title', 'Fresh private writing')
          submitCreator(fresh)
          host.drain(10_000)
          expect(current.started()).toBe(true)
          yield* Effect.promise(() => current.entered)
          expect(disabled(fresh, 'Save draft')).toBe(true)
          expect(writes).toHaveLength(2)
          expect(writes[1]).toMatchObject({
            title: 'Fresh private writing',
            creatorIds: [mode === 'other-account' ? 'owner-b' : 'owner-a'],
          })
          old.respond(
            Response.json({
              id: 'old-published-post',
              slug: 'old-private-post',
              updatedAt: '2026-11-27T00:00:00.000Z',
            }),
          )
          yield* Effect.promise(() => old.delivered)
          yield* Effect.promise(() => oldPublished.promise)
          host.drain(10_000)
          expect(old.outcomes).toEqual([200])
          expect(accepted).toEqual([
            expect.objectContaining({
              title: 'Old account private writing',
              creatorIds: ['owner-a'],
            }),
          ])
          expect(fieldValue(fresh, 'title')).toBe('Fresh private writing')
          expect(disabled(fresh, 'Save draft')).toBe(true)
          expect(fresh.query(Locator.attr('href', '/tweet/old-private-post'))).toBeUndefined()
          expect(fresh.text()).not.toContain('Old account private writing')
          current.respond(new Response(null, { status: 409 }))
          yield* TestHost.settle
          expect(fresh.text()).toContain('This post changed in another editor or connected app.')
          expect(fieldValue(fresh, 'title')).toBe('Fresh private writing')
          expect(disabled(fresh, 'Save draft')).toBe(false)
          expect(current.outcomes).toEqual([409])
          expect(fixture.requests.filter(({ path }) => path === '/new/tweet')).toHaveLength(2)
        }),
      )
    },
  )

  for (const status of [200, 503]) {
    it.each(modes)(
      `drops an old Dashboard save (${status}) after %s while the fresh account command remains pending`,
      async (mode) => {
        const fixture = documents('/dashboard/profile')
        const old = responseGate()
        const current = responseGate()
        const writes: Array<RequestFields> = []

        const fetch: typeof globalThis.fetch = (input, init) => {
          const url = new URL(input instanceof Request ? input.url : input, fixture.props.url)

          if (url.pathname !== '/api/user/profile' || init?.method !== 'PATCH')
            return Promise.reject(new Error(`Unexpected Dashboard request ${url.pathname}`))
          writes.push(requestFields(init.body))

          return (writes.length === 1 ? old : current).request(init.signal)
        }

        await runWithLayer(
          routedLayer(fixture, fetch),
          Effect.gen(function* () {
            const host = yield* TestHost.TestHost
            const scope = yield* Scope.fork(yield* Scope.Scope)

            const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props).pipe(
              Effect.provideService(Scope.Scope, scope),
            )

            yield* TestHost.settle
            input(root, 'username', 'old-private-username')
            click(root, 'Save changes')
            host.drain(10_000)
            expect(old.started()).toBe(true)
            yield* Effect.promise(() => old.entered)
            const transition = yield* reenter(fixture, root, scope, mode)
            const fresh = transition.root
            expect(transition.away).toMatchObject({ creator: false, dashboard: false })
            expect(transition.away.text).not.toContain('old-private-username')
            expect(transition.loading).toMatchObject({ creator: false, dashboard: false })
            expect(transition.loading.epoch).toBeGreaterThan(0)
            expect(old.aborted()).toBe(true)
            expect(fieldValue(fresh, 'username')).not.toBe('old-private-username')
            input(fresh, 'username', 'fresh-private-username')
            click(fresh, 'Save changes')
            host.drain(10_000)
            expect(current.started()).toBe(true)
            yield* Effect.promise(() => current.entered)
            expect(fresh.text()).toContain('Saving…')
            old.respond(new Response(null, { status }))
            yield* Effect.promise(() => old.delivered)
            host.drain(10_000)
            expect(old.outcomes).toEqual([status])
            expect(fieldValue(fresh, 'username')).toBe('fresh-private-username')
            expect(fresh.text()).toContain('Saving…')
            expect(fresh.text()).not.toContain('Changes saved.')
            expect(fresh.text()).not.toContain('Could not save changes.')
            expect(fresh.text()).not.toContain('old-private-username')
            current.respond(Response.json({}))
            yield* TestHost.settle
            expect(fieldValue(fresh, 'username')).toBe('fresh-private-username')
            expect(fresh.text()).toContain('Changes saved.')
            expect(fresh.text()).not.toContain('Could not save changes.')
            expect(writes).toEqual([
              expect.objectContaining({
                username: 'old-private-username',
                email: 'owner-a@example.test',
              }),
              expect.objectContaining({
                username: 'fresh-private-username',
                email: `${mode === 'other-account' ? 'owner-b' : 'owner-a'}@example.test`,
              }),
            ])
          }),
        )
      },
    )
  }

  it.each([false, true])(
    'preserves the uncertain Dashboard removal request through root refresh when the row disappears: %s',
    async (missing) => {
      let refreshed = false

      const fixture = documents('/dashboard/favorites', () => ({
        ...emptyDocument,
        rows:
          refreshed && missing
            ? []
            : [
                {
                  id: 'private-favorite',
                  title: 'Private favorite awaiting acknowledgement',
                  detail: 'Synthetic private favorite',
                  href: null,
                  actionId: 'audio-a',
                  membershipRevision: refreshed ? 31 : 7,
                },
              ],
      }))

      const writes: Array<{
        readonly path: string
        readonly body: RequestFields
      }> = []

      const applied = new Set<string | undefined>()

      const fetch: typeof globalThis.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input, fixture.props.url)

        if (url.pathname === '/api/favorites' && (init?.method ?? 'GET') === 'GET')
          return Promise.resolve(Response.json({ success: true, total: 0, favorites: [] }))

        if (url.pathname !== '/api/favorites/audio-a' || init?.method !== 'DELETE')
          return Promise.reject(new Error(`Unexpected Dashboard request ${url.pathname}`))
        const payload = requestFields(init.body)
        writes.push({ path: url.pathname, body: payload })
        applied.add(payload.requestId)

        return writes.length === 1
          ? Promise.reject(new TypeError('Response lost after commit'))
          : Promise.resolve(new Response(null, { status: 204 }))
      }

      await runWithLayer(
        routedLayer(fixture, fetch),
        Effect.gen(function* () {
          const host = yield* TestHost.TestHost
          const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
          yield* TestHost.settle
          click(root, 'Remove')
          yield* TestHost.settle
          expect(writes).toHaveLength(1)
          expect(writes[0]).toMatchObject({
            path: '/api/favorites/audio-a',
            body: { expectedRevision: 7, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
          })
          expect(root.text()).toContain('Could not reach the dashboard API.')
          expect(root.query(Locator.text('Retry removal'))).toBeDefined()
          refreshed = true
          const pending = fixture.holdNext()
          root.send(RoutedApplicationMessage.ClickedRetryPage())
          host.drain(10_000)
          yield* Effect.promise(() => pending.entered)
          expect(root.text()).not.toContain('Private favorite awaiting acknowledgement')
          expect(root.text()).not.toContain('Could not reach the dashboard API.')
          pending.resume()
          yield* TestHost.settle
          expect(root.model()?.identity.epoch).toBeGreaterThan(0)
          const retry = missing ? 'Retry pending removal' : 'Retry removal'
          expect(root.query(Locator.text(retry))).toBeDefined()
          click(root, retry)
          yield* TestHost.settle
          expect(writes).toHaveLength(2)
          expect(writes[1]).toEqual(writes[0])
          expect(applied.size).toBe(1)
          expect(root.text()).not.toContain('Could not reach the dashboard API.')
          expect(root.query(Locator.text('Retry pending removal'))).toBeUndefined()
        }),
      )
    },
  )
})
