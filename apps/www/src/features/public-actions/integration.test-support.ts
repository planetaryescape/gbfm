import { Component, type MessageLog, Router, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { QueueTrack } from '@gbfm/player'
import { makeStaticSiteMetadata } from '@gbfm/site-metadata'
import { Effect, Layer, Option, Predicate, Schema, Stream, type Scope } from 'effect'
import { HttpClient } from 'effect/http'

import { browserPageLayer } from '../../app/page-query'
import { AppRoute } from '../../app/route'
import {
  AppBootstrap,
  FollowPageLocation,
  InvalidatePages,
  ReadRouteLocation,
  ReportNavigation,
} from '../../app/routed-application'
import { ContentItem } from '../../domain/content-item'
import { PageDocument } from '../../domain/page'
import { PublicActionDocument } from '../../domain/public-action'
import { PerformPlayer } from '../player/commands'
import { initialSnapshot } from '../player/domain'
import { PlayerFavorite } from '../player/favorite-control'
import { PlayerProvider } from '../player/provider'
import { PlayerSnapshotSource } from '../player/subscriptions'
import { PerformSpotify, ReadSpotifyStatus } from '../spotify/commands'
import { SpotifyProviderMessage } from '../spotify/domain'
import { MembershipButton } from './button'
import { LoadMembership, MembershipHttp, MembershipRequestError, SaveMembership } from './commands'
import { MembershipModel, MembershipProps } from './domain'
import { MembershipProvider } from './provider'

export const audioA = { kind: 'audio', id: 'audio-a' } satisfies PublicActionDocument['target']

export const audioB = { kind: 'audio', id: 'audio-b' } satisfies PublicActionDocument['target']

export const listener = { principalId: 'account-a', principalKnown: true }

export const mutationId = '00000000-0000-4000-8000-000000000001'

const context = Schema.Struct({
  ...MembershipProps.fields,
  targets: Schema.Array(PublicActionDocument),
})

export const IntegrationContextMessage = UiSchema.TaggedEnum({ ChangedContext: { context } })

export const document = (
  target: PublicActionDocument['target'] = audioA,
  state: PublicActionDocument['state'] = 'inactive',
): PublicActionDocument => ({
  target,
  state,
  path: `/mixes/${target.id}`,
})

export const controlsContext = { ...listener, targets: [document()] }

export const MembershipControls = Html.component({
  name: 'MembershipControls',
  props: context,
  model: context,
  message: IntegrationContextMessage,
}).make({
  init: ($) => $.props,
  update: { ChangedContext: ($, { context }) => $.set(context) },
  view: (h, model) =>
    PlayerProvider(h, {
      props: {
        principalId: model.principalId,
        principalKnown: model.principalKnown,
        returnTo: '/about',
      },
      view: () =>
        MembershipProvider(h, {
          props: {
            principalId: model.principalId,
            principalKnown: model.principalKnown,
            lifecycle: model.lifecycle,
          },
          view: () =>
            h.div.children(
              model.targets.map((document) =>
                h.section
                  .attr('data-target', document.target.id)
                  .attr('data-kind', document.target.kind)
                  .children(
                    MembershipButton(h, {
                      key: `${document.target.kind}:${document.target.id}`,
                      props: { document },
                    }),
                  ),
              ),
              h.section.attr('data-target', 'player').children(PlayerFavorite(h, {})),
            ),
        }),
    }),
})

export const track = QueueTrack.make({
  id: audioA.id,
  slug: audioA.id,
  title: 'Audio A',
  url: 'https://cdn.example.test/audio-a.mp3',
  thumbnailUrl: null,
  type: 'mix',
})

export const playerLayer = Layer.mergeAll(
  PerformPlayer.toLayer(() => Effect.succeed(Component.noop)),
  Layer.succeed(PlayerSnapshotSource, {
    snapshots: Stream.succeed({
      ...initialSnapshot,
      queue: { tracks: [track], current: track, currentIndex: 0 },
    }),
  }),
)

export const runWithLayer = <A, E, R>(
  program: Effect.Effect<A, E, R | Scope.Scope>,
  layer: Layer.Layer<R>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer)

        return yield* Effect.provide(program, context)
      }),
    ),
  )

export const membershipState = (root: { readonly log: () => ReadonlyArray<MessageLog.Entry> }) => {
  const entries = root
    .log()
    .filter(
      (entry) =>
        (Predicate.isTagged(entry, 'Mounted') || Predicate.isTagged(entry, 'Update')) &&
        entry.path.endsWith('/MembershipProvider[]'),
    )

  const last = entries.at(-1)

  if (!last || (!Predicate.isTagged(last, 'Mounted') && !Predicate.isTagged(last, 'Update')))
    throw new Error('No native membership owner state was recorded')

  return Schema.decodeUnknownSync(MembershipModel)(last.model)
}

export const control = (
  root: TestHost.TestRoot<unknown, never, unknown>,
  id: string,
  kind: 'audio' | 'show' = 'audio',
) => {
  const container = root
    .all(Locator.attr('data-target', id))
    .find(
      (node) =>
        Predicate.isTagged(node, 'Element') &&
        (id === 'player' || node.attrs['data-kind'] === kind),
    )

  if (!container) throw new Error('Missing membership container')
  const button = Locator.tag('button').all(container)[0]

  if (!button || !Predicate.isTagged(button, 'Element'))
    throw new Error('Missing membership control')

  return button
}

export const MutationBody = Schema.Struct({
  requestId: Schema.String,
  expectedRevision: Schema.Number,
  audioId: Schema.optional(Schema.String),
})

export type MutationBody = typeof MutationBody.Type

export const membershipAdapter = (
  write: (body: MutationBody) => Promise<Response>,
  read?: (url: string) => Promise<Response>,
) => {
  const reads: Array<string> = []
  const writes: Array<MutationBody> = []
  let ids = 0

  const layer = Layer.merge(LoadMembership.layer, SaveMembership.layer).pipe(
    Layer.provide(
      Layer.succeed(MembershipHttp, {
        requestId: Effect.sync(() => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`),
        request: (url, init) => {
          if (!init?.method) {
            reads.push(url)

            if (read)
              return Effect.tryPromise({
                try: () => read(url),
                catch: () => new MembershipRequestError(),
              })

            return Effect.succeed(
              Response.json({ revision: 17, favorited: false, subscribed: false }),
            )
          }

          const body = Schema.decodeUnknownOption(Schema.fromJsonString(MutationBody))(init.body)

          if (Option.isNone(body)) return Effect.fail(new MembershipRequestError())
          writes.push(body.value)

          return Effect.tryPromise({
            try: () => write(body.value),
            catch: () => new MembershipRequestError(),
          })
        },
      }),
    ),
  )

  return { layer, reads, writes }
}

export const receipt = (
  requestId = mutationId,
  targetId = audioA.id,
  desiredState = true,
  revision = 18,
) =>
  Response.json({
    requestId,
    targetKind: 'audio',
    targetId,
    desiredState,
    revision,
    operationId: 'a'.repeat(64),
    notifications: 'not_sent',
  })

export const page = (
  path: string,
  principalId: string | null = listener.principalId,
  target = audioA,
  known = true,
) =>
  PageDocument.make({
    url: `https://goosebumps.fm${path}`,
    status: 200,
    principal: principalId
      ? { id: principalId, name: principalId, username: null, role: 'user' }
      : null,
    principalKnown: known,
    items: path.startsWith('/mixes/')
      ? [
          ContentItem.make({
            id: target.id,
            slug: target.id,
            title: target.id,
            description: '',
            imageUrl: null,
            href: `/mixes/${target.id}`,
            meta: '',
            content: '',
            richContent: null,
            audioUrl: track.url,
            audioType: 'mix',
            show: null,
            creators: [],
            tags: [],
            streamingLinks: [],
          }),
        ]
      : [],
    title: path,
    description: '',
    requestId: `request:${path}`,
    renderedAt: 1,
    skipSeen: false,
    tweet: null,
    neighbours: null,
    dashboard: null,
    profile: null,
    shows: null,
    changelog: null,
    publicAction: path.startsWith('/mixes/') ? document(target) : null,
    metadata: makeStaticSiteMetadata(path, '', new URL(path, 'https://goosebumps.fm').pathname),
    failure: null,
  })

export const bootstrap = () =>
  AppBootstrap.make({
    url: new URL('https://goosebumps.fm/mixes/audio-a'),
    metadata: makeStaticSiteMetadata('Audio A', '', '/mixes/audio-a'),
    identity: { principalId: listener.principalId, known: true, epoch: 0 },
    realm: 'membership-parity-fixture',
  })

export const rootLayer = (
  fetchPage: typeof fetch,
  membership: Layer.Layer<LoadMembership | SaveMembership>,
) => {
  const props = bootstrap()

  return Layer.mergeAll(
    TestHost.layer(),
    playerLayer,
    membership,
    browserPageLayer(props.url, props.realm, fetchPage),
    Layer.mergeAll(FollowPageLocation.layer, ReadRouteLocation.layer, InvalidatePages.layer).pipe(
      Layer.provideMerge(Router.memory({ routes: AppRoute, url: '/mixes/audio-a' })),
    ),
    ReportNavigation.toLayer(() => Effect.void),
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
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die(new Error('Unexpected fixture HTTP request'))),
    ),
  )
}
