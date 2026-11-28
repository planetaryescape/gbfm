import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { makeStaticSiteMetadata } from '@gbfm/site-metadata'
import { Effect, Layer, Predicate, Schema } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'

import { PageDocument } from '../domain/page'
import { emptyDocument, type DashboardDocument } from '../features/dashboard/document'
import { nativePlayerServerLayer } from '../features/player/provider'
import { LoadMembership, SaveMembership } from '../features/public-actions/commands'
import { MembershipMessage } from '../features/public-actions/domain'
import { PerformSpotify, ReadSpotifyStatus } from '../features/spotify/commands'
import { SpotifyProviderMessage } from '../features/spotify/domain'
import { GetPage } from './page-query'
import { AppRoute } from './route'
import {
  AppBootstrap,
  FollowPageLocation,
  InvalidatePages,
  ReadRouteLocation,
  ReportNavigation,
  type RoutedApplicationMessage,
  type RoutedApplicationModel,
} from './routed-application'

export type RoutedRoot = TestHost.TestRoot<
  RoutedApplicationModel,
  typeof RoutedApplicationMessage.Type,
  never
>

const RequestFields = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  creatorIds: Schema.optional(Schema.Array(Schema.String)),
  username: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  bio: Schema.optional(Schema.String),
  expectedRevision: Schema.optional(Schema.Number),
  requestId: Schema.optional(Schema.String),
})

export type RequestFields = typeof RequestFields.Type

export const requestFields = Schema.decodeUnknownSync(Schema.fromJsonString(RequestFields))

export const responseGate = () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const delivered = Promise.withResolvers<void>()
  const outcomes: Array<number> = []
  let started = false
  let aborted = false

  return {
    entered: entered.promise,
    delivered: delivered.promise,
    outcomes,
    started: () => started,
    aborted: () => aborted,
    respond: (response: Response) => release.resolve(response),
    request: (signal: AbortSignal | null | undefined) => {
      started = true
      aborted = signal?.aborted ?? false
      signal?.addEventListener(
        'abort',
        () => {
          aborted = true
        },
        { once: true },
      )
      entered.resolve()

      return release.promise.then((response) => {
        outcomes.push(response.status)
        delivered.resolve()

        return response
      })
    },
  }
}

export const fieldValue = (root: RoutedRoot, name: string) => {
  const node = root.get(Locator.attr('name', name))

  if (!Predicate.isTagged(node, 'Element')) throw new Error(`Missing ${name} input`)

  return node.props.value ?? node.attrs.value
}

export const input = (root: RoutedRoot, name: string, value: string) =>
  Locator.fire(root.get(Locator.attr('name', name)), 'input', { value })

export const click = (root: RoutedRoot, label: string) =>
  Locator.fire(root.get(Locator.text(label)), 'click')

export const submitCreator = (root: RoutedRoot) =>
  Locator.fire(root.get(Locator.attr('aria-label', 'Content editor')), 'submit', {
    entries: [['intent', 'draft']],
  })

export const disabled = (root: RoutedRoot, label: string) => {
  const node = root.get(Locator.text(label))

  if (!Predicate.isTagged(node, 'Element')) throw new Error(`Missing ${label} button`)

  return 'disabled' in node.attrs || node.props.disabled === true
}

export const documents = (
  path: string,
  dashboardDocument?: (account: string, generation: number) => DashboardDocument,
) => {
  let account = 'owner-a'
  let generation = 0
  const requests: Array<{ path: string; account: string; epoch: number }> = []

  let held:
    | {
        readonly entered: ReturnType<typeof Promise.withResolvers<void>>
        readonly released: ReturnType<typeof Promise.withResolvers<void>>
      }
    | undefined

  const props = AppBootstrap.make({
    url: new URL(path, 'https://goosebumps.fm'),
    metadata: makeStaticSiteMetadata('Initial private page', 'Fixture', path),
    identity: { principalId: account, known: true, epoch: 0 },
    realm: 'routed-feature-lifetime',
  })

  const layer = GetPage.toLayer(({ path: requestedPath, identity }) =>
    Effect.gen(function* () {
      requests.push({ path: requestedPath, account, epoch: identity.epoch })
      const wait = held
      held = undefined

      if (wait) {
        wait.entered.resolve()
        yield* Effect.promise(() => wait.released.promise)
      }

      generation += 1

      return PageDocument.make({
        url: new URL(requestedPath, props.url).href,
        status: 200,
        principal: { id: account, name: account, username: account, role: 'admin' },
        principalKnown: true,
        items: [],
        title: requestedPath === '/about' ? 'About' : `Private page ${account} ${generation}`,
        description: 'Private route fixture',
        requestId: `private-${generation}`,
        renderedAt: generation,
        skipSeen: false,
        tweet: null,
        neighbours: null,
        dashboard: requestedPath.startsWith('/dashboard')
          ? (dashboardDocument?.(account, generation) ?? {
              ...emptyDocument,
              fields: {
                username: `fresh-${account}-${generation}`,
                email: `${account}@example.test`,
                bio: '',
              },
              rows: [
                {
                  id: `row-${account}-${generation}`,
                  title: `Private collection ${account} ${generation}`,
                  detail: 'Private fixture row',
                  href: null,
                  actionId: null,
                },
              ],
            })
          : null,
        profile: null,
        shows: null,
        changelog: null,
        publicAction: null,
        metadata: makeStaticSiteMetadata(
          requestedPath === '/about' ? 'About' : `Private page ${account} ${generation}`,
          'Fixture',
          requestedPath,
        ),
        failure: null,
      })
    }),
  )

  return {
    props,
    layer,
    requests,
    account: (id: string) => {
      account = id
    },
    holdNext: () => {
      const entered = Promise.withResolvers<void>()
      const released = Promise.withResolvers<void>()
      held = { entered, released }

      return { entered: entered.promise, resume: () => released.resolve() }
    },
  }
}

const membership = Layer.mergeAll(
  LoadMembership.toLayer((args) =>
    Effect.succeed(
      MembershipMessage.SucceededLoadMembership({ ...args, active: false, revision: 0 }),
    ),
  ),
  SaveMembership.toLayer(() => Effect.die(new Error('Unexpected membership mutation'))),
)

const spotify = Layer.mergeAll(
  ReadSpotifyStatus.toLayer(() => Effect.succeed({ connected: false, name: '' })),
  PerformSpotify.toLayer(({ identity, requestId, revision }) =>
    Effect.succeed(
      SpotifyProviderMessage.CompletedOperation({
        identity,
        requestId,
        revision,
        status: null,
        notice: '',
      }),
    ),
  ),
)

export const routedLayer = (
  fixture: ReturnType<typeof documents>,
  fetch: typeof globalThis.fetch,
) => {
  const router = Router.memory({
    routes: AppRoute,
    url: `${fixture.props.url.pathname}${fixture.props.url.search}`,
  })

  return Layer.mergeAll(
    TestHost.layer(),
    fixture.layer,
    nativePlayerServerLayer,
    membership,
    spotify,
    Layer.mergeAll(FollowPageLocation.layer, ReadRouteLocation.layer, InvalidatePages.layer).pipe(
      Layer.provideMerge(router),
    ),
    ReportNavigation.toLayer(() => Effect.void),
    Layer.succeed(FetchHttpClient.Fetch, fetch),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die(new Error('Unexpected root HTTP request'))),
    ),
  )
}
