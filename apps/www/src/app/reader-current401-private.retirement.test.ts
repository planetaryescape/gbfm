import { Locator, TestHost } from '@effect/ui/testing'
import { JourneyExporter, observabilityLayer } from '@gbfm/observability'
import type { NowPlayingMetadata, QueueTrackType } from '@gbfm/player'
import { Effect, Layer, Predicate } from 'effect'
import { expect, it } from 'vitest'

import { playerCommandsLayer } from '../features/player/provider'
import { LoadMembership, MembershipHttp, SaveMembership } from '../features/public-actions/commands'
import { MembershipMessage } from '../features/public-actions/domain'
import { openRetirementPlayer } from '../features/public-actions/retirement.test-support'
import { makePlayerClientLayer, PlayerClient, type AudioPort } from '../player/runtime'
import { browserPageLayer } from './page-query'
import { RoutedApplicationNoDeps } from './routed-application'
import {
  makeReaderLifetimeFixture,
  readerDocument,
  runReaderLifetime,
} from './routed-reader-lifetime.test-support'

class LeaseAudioPort extends EventTarget implements AudioPort {
  src = ''
  currentTime = 0
  duration = 120
  paused = true
  ended = false
  readyState = 4
  volume = 1
  muted = false
  load() {
    this.dispatchEvent(new Event('loadedmetadata'))
  }
  removeAttribute() {
    this.src = ''
  }
  async play() {
    this.paused = false
    this.dispatchEvent(new Event('play'))
    this.dispatchEvent(new Event('playing'))
  }
  pause() {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
}

it('a matched current401 conceals actual authorized private current and queued metadata during held principal verification', async () => {
  const fixture = makeReaderLifetimeFixture('/about')
  const props = { ...fixture.props, identity: { known: true, principalId: 'owner-a', epoch: 0 } }
  const principal = { id: 'owner-a', name: 'Owner A', username: 'owner-a', role: 'user' }
  const refresh = Promise.withResolvers<Response>()
  let reads = 0
  let writes = 0

  const pages = browserPageLayer(props.url, props.realm, async () => {
    reads++

    return reads === 1
      ? Response.json({ ...readerDocument('/about'), principal, principalKnown: true })
      : refresh.promise.then((response) => response.clone())
  })

  const http = Layer.succeed(MembershipHttp, {
    request: (_url, init) =>
      Effect.sync(() => {
        if (init?.method === 'POST') writes++

        return new Response(null, { status: 401 })
      }),
    requestId: Effect.sync(() => crypto.randomUUID()),
  })

  const membership = Layer.merge(
    LoadMembership.toLayer((args) =>
      Effect.succeed(
        MembershipMessage.SucceededLoadMembership({ ...args, active: false, revision: 17 }),
      ),
    ),
    SaveMembership.layer.pipe(Layer.provide(http)),
  )

  const metadata: Array<NowPlayingMetadata | null> = []

  const client = makePlayerClientLayer({
    isolatePrivateMedia: true,
    storage: () => undefined,
    deliverPlay: () => Effect.void,
    reporter: {},
    createAudio: () => new LeaseAudioPort(),
    createPreview: () => ({ ensure: async () => ({ ok: true }), dispose: () => {} }),
    setMediaSessionMetadata: (value) => {
      metadata.push(value)
    },
  }).pipe(
    Layer.provide(
      observabilityLayer.pipe(
        Layer.provide(
          Layer.succeed(JourneyExporter, {
            open: () => Effect.succeed({ finish: () => Effect.void }),
          }),
        ),
      ),
    ),
  )

  const player = playerCommandsLayer.pipe(Layer.provideMerge(client))

  const track = (id: string, title: string): QueueTrackType => ({
    id,
    slug: id,
    title,
    type: 'mix',
    thumbnailUrl: null,
    url: `https://cdn.fixture.test/user-content/private/owner-a/audio/${id}.mp3`,
  })

  const current = track('private-current', 'Secret current metadata A')
  const queued = track('private-queued', 'Secret queued metadata A')
  await runReaderLifetime(
    { layer: Layer.mergeAll(fixture.layer, pages, membership, player) },
    Effect.gen(function* () {
      const root = yield* TestHost.mount(RoutedApplicationNoDeps, props)
      yield* TestHost.settle
      const client = yield* PlayerClient
      yield* client.controller.playAll([queued])
      yield* TestHost.settle
      yield* client.controller.playAll([current, queued])
      yield* TestHost.settle
      yield* openRetirementPlayer(root)

      const queue = root
        .all(Locator.tag('button'))
        .filter(
          (node) =>
            Predicate.isTagged(node, 'Element') && node.attrs['aria-label']?.startsWith('Queue ('),
        )

      expect(queue).toHaveLength(1)
      const queueButton = queue.at(0)

      if (!queueButton) throw new Error('Missing native queue control')
      Locator.fire(queueButton, 'click')
      yield* TestHost.settle
      expect(root.text()).toContain(current.title)
      expect(root.text()).toContain(queued.title)
      const favorite = root.get(Locator.attr('aria-label', 'Add to favorites'))
      Locator.fire(favorite, 'click')
      yield* TestHost.settle
      expect(writes).toBe(1)
      expect(reads).toBe(2)
      expect(root.model()?.membershipPrincipalKnown).toBe(false)
      expect(root.model()?.membershipPrincipalId).toBeNull()
      expect.soft(root.text()).not.toContain(current.title)
      expect.soft(root.text()).not.toContain(queued.title)
      expect.soft(root.all(Locator.attr('aria-label', 'Add to favorites'))).toHaveLength(0)
      expect.soft(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
      expect.soft(metadata.at(-1)?.title).not.toBe(current.title)
      refresh.resolve(
        Response.json({ ...readerDocument('/about'), principal: null, principalKnown: false }),
      )
      yield* TestHost.settle
      expect(writes).toBe(1)
    }),
  )
})
