import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer, Predicate, Schema, type Scope } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { expect } from 'vitest'

import { CreatorPageModel } from '../features/creator/state'
import { pageFixture } from '../server/page-fixture.test-support'
import { browserPageLayer } from './page-query'
import { RoutedApplicationNoDeps } from './routed-application'
import {
  documents,
  input,
  requestFields,
  responseGate,
  routedLayer,
  type RequestFields,
} from './routed-feature-lifetime.test-support'
import { pumpReaderUntil, runReaderLifetime } from './routed-reader-lifetime.test-support'

export const privateTitle = 'Owner A unsaved private writing'

export const makeCreatorLeaseFixture = (path: string) => {
  const base = documents(path)
  const requests: Array<string> = []
  const writes: Array<RequestFields> = []
  const apiRequests: Array<string> = []
  const saves = [responseGate(), responseGate()]
  const held = new Map<string, Array<ReturnType<typeof responseGate>>>()
  const active = new Map<string, ReturnType<typeof responseGate>>()
  let owner: string | null = 'owner-a'
  let known = true

  const document = (
    location = path,
    principalId = owner,
    principalKnown = known,
    status = 200,
  ) => ({
    ...pageFixture(location).flags,
    url: new URL(location, base.props.url).href,
    title: `Private header ${principalId ?? 'unverified'}`,
    metadata: null,
    principal: principalId
      ? { id: principalId, name: principalId, username: principalId, role: 'admin' }
      : null,
    principalKnown,
    status,
  })

  const pages = browserPageLayer(base.props.url, base.props.realm, async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    url.searchParams.delete('__data')
    const location = `${url.pathname}${url.search}`
    requests.push(location)
    const gate = held.get(location)?.shift() ?? active.get(location)

    if (gate) {
      active.set(location, gate)

      return gate.request(init?.signal).then((response) => response.clone())
    }

    return Response.json(document(location))
  })

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, base.props.url)
    apiRequests.push(`${init?.method ?? 'GET'} ${url.pathname}`)

    if (url.pathname.endsWith('/edit')) {
      return Response.json({
        id: 'existing-id',
        title: 'Remote title',
        slug: 'existing',
        content: '',
        description: null,
        tags: [],
        thumbnailUrl: null,
        type: 'post',
        updatedAt: '2026-11-27T00:00:00.000Z',
        creators: [{ id: owner ?? 'owner-a', name: null, username: owner ?? 'owner-a' }],
        draft: true,
      })
    }

    if (url.pathname.endsWith('/preview'))
      return Response.json({ richContent: { version: 1, blocks: [] } })

    if (
      ['POST', 'PATCH', 'PUT'].includes(init?.method ?? '') &&
      url.pathname.startsWith('/api/content/')
    ) {
      writes.push(requestFields(init?.body))
      const gate = saves[writes.length - 1]

      if (!gate) throw new Error('Unexpected automatic Creator write')

      return gate.request(init?.signal)
    }

    return new Response(null, { status: 404 })
  }

  return {
    ...base,
    layer: Layer.mergeAll(
      routedLayer(base, fetch),
      pages,
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.promise(() => fetch(request.url, { method: request.method })).pipe(
            Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
          ),
        ).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(base.props.url.origin))),
      ),
    ),
    requests,
    writes,
    apiRequests,
    saves,
    document,
    account: (principalId: string | null, principalKnown = true) => {
      owner = principalId
      known = principalKnown
    },
    hold: (location = path) => {
      const gate = responseGate()
      held.set(location, [...(held.get(location) ?? []), gate])

      return {
        ...gate,
        respond: (response: Response) => {
          if (active.get(location) === gate) active.delete(location)
          gate.respond(response)
        },
      }
    },
  }
}

export type CreatorLeaseFixture = ReturnType<typeof makeCreatorLeaseFixture>

type LeaseTestRoot = TestHost.TestRoot<unknown, never, unknown>

export const creatorModel = (root: LeaseTestRoot, owner = 'owner-a') => {
  const entry = root
    .log()
    .findLast(
      (entry) =>
        (Predicate.isTagged(entry, 'Mounted') || Predicate.isTagged(entry, 'Update')) &&
        entry.path.includes(`/CreatorPage[creator:${owner}:`) &&
        Schema.is(CreatorPageModel)(entry.model),
    )

  if (!entry || (!Predicate.isTagged(entry, 'Mounted') && !Predicate.isTagged(entry, 'Update')))
    throw new Error(`Missing actual Creator model for ${owner}`)

  return Schema.decodeUnknownSync(CreatorPageModel)(entry.model)
}

export const creatorPath = (root: LeaseTestRoot, owner = 'owner-a') => {
  const entry = root
    .log()
    .findLast(
      (entry) =>
        Predicate.isTagged(entry, 'Mounted') &&
        entry.path.includes(`/CreatorPage[creator:${owner}:`) &&
        Schema.is(CreatorPageModel)(entry.model),
    )

  if (!entry || !Predicate.isTagged(entry, 'Mounted')) throw new Error('Missing Creator mount')

  return entry.path
}

export const openCreatorChooser = (root: LeaseTestRoot, path: string) =>
  Effect.gen(function* () {
    if (
      new URL(path, 'https://fixture.test').pathname === '/new' &&
      root.query(Locator.attr('name', 'title')) === undefined
    ) {
      Locator.fire(root.get(Locator.attr('href', '/new/editorial')), 'click')
      yield* TestHost.settle
    }
  })

export const mountWriting = (fixture: CreatorLeaseFixture) =>
  Effect.gen(function* () {
    const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
    yield* TestHost.settle
    yield* openCreatorChooser(root, fixture.props.url.href)
    yield* pumpReaderUntil(() => creatorModel(root).ready || creatorModel(root).error !== null)
    expect(creatorModel(root)).toMatchObject({
      ready: true,
      error: null,
    })
    input(root, 'title', privateTitle)

    if (fixture.props.url.pathname === '/new/mix') {
      input(root, 'audioUrl', 'https://cdn.fixture.test/disposable-lease.mp3')
    }

    yield* TestHost.settle
    expect(creatorModel(root).draft.title).toBe(privateTitle)

    return root
  })

export const beginSave = (root: LeaseTestRoot, fixture: CreatorLeaseFixture) =>
  Effect.gen(function* () {
    Locator.fire(root.get(Locator.attr('aria-label', 'Content editor')), 'submit', {
      entries: [['intent', 'draft']],
    })
    yield* pumpReaderUntil(() => fixture.saves[0]?.started())
    expect(fixture.writes).toHaveLength(1)
    expect(fixture.writes[0]?.title).toBe(privateTitle)
    expect(creatorModel(root).saving).toBe(true)
  })

export const completeSave = (fixture: CreatorLeaseFixture, outcome: string, index = 0) => {
  const gate = fixture.saves[index]

  if (!gate) throw new Error('Missing fixture save gate')
  gate.respond(
    outcome === 'success'
      ? Response.json({
          id: 'existing-id',
          slug: fixture.props.url.searchParams.has('edit') ? 'existing' : 'lease-saved',
          updatedAt: '2026-11-27T00:00:01.000Z',
        })
      : new Response(null, { status: 409 }),
  )
}

export const expectWritingAbsent = (root: LeaseTestRoot) => {
  expect(root.query(Locator.attr('name', 'title'))).toBeUndefined()
  expect(root.query(Locator.attr('aria-label', 'Content editor'))).toBeUndefined()
  expect(root.text()).not.toContain(privateTitle)
  expect(root.head<{ title: string }>().title).not.toContain('Private header owner-a')
}

export const runCreatorLease = async <A, E, R>(
  fixture: { readonly layer: Layer.Layer<R> },
  program: Effect.Effect<A, E, R | Scope.Scope>,
) => {
  const bytes = new Map<string, string>()

  const storage: Storage = {
    get length() {
      return bytes.size
    },
    getItem: (key) => bytes.get(key) ?? null,
    setItem: (key, value) => {
      bytes.set(key, value)
    },
    removeItem: (key) => {
      bytes.delete(key)
    },
    clear: () => bytes.clear(),
    key: (index) => [...bytes.keys()][index] ?? null,
  }

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })

  try {
    return await runReaderLifetime(fixture, program)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
}
