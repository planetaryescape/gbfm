import { Locator, TestHost } from '@effect/ui/testing'
import { JourneyExporter, observabilityLayer } from '@gbfm/observability'
import type { NowPlayingMetadata, QueueTrackType } from '@gbfm/player'
import { Effect, Layer } from 'effect'
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

class MetadataAudioPort extends EventTarget implements AudioPort {
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

it('matched Root current401 publishes exactly null media metadata before held verification resolves', async () => {
  const fixture = makeReaderLifetimeFixture('/about')
  const props = { ...fixture.props, identity: { known: true, principalId: 'owner-a', epoch: 0 } }
  const principal = { id: 'owner-a', name: 'Owner A', username: 'owner-a', role: 'user' }
  const verification = Promise.withResolvers<Response>()
  const metadata: Array<NowPlayingMetadata | null> = []
  let reads = 0
  let writes = 0
  let verified = false

  const pages = browserPageLayer(props.url, props.realm, async () => {
    reads++

    if (reads === 1)
      return Response.json({ ...readerDocument('/about'), principal, principalKnown: true })

    const response = await verification.promise
    verified = true

    return response.clone()
  })

  const membership = Layer.merge(
    LoadMembership.toLayer((args) =>
      Effect.succeed(
        MembershipMessage.SucceededLoadMembership({ ...args, active: false, revision: 17 }),
      ),
    ),
    SaveMembership.layer.pipe(
      Layer.provide(
        Layer.succeed(MembershipHttp, {
          request: (_url, init) =>
            Effect.sync(() => {
              if (init?.method === 'POST') writes++

              return new Response(null, { status: 401 })
            }),
          requestId: Effect.sync(() => crypto.randomUUID()),
        }),
      ),
    ),
  )

  const client = makePlayerClientLayer({
    isolatePrivateMedia: true,
    storage: () => undefined,
    deliverPlay: () => Effect.void,
    reporter: {},
    createAudio: () => new MetadataAudioPort(),
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

  const track: QueueTrackType = {
    id: 'private-metadata-null',
    slug: 'private-metadata-null',
    title: 'Private current metadata before suspension',
    type: 'mix',
    thumbnailUrl: null,
    url: 'https://cdn.fixture.test/user-content/private/owner-a/audio/metadata-null.mp3',
  }

  await runReaderLifetime(
    { layer: Layer.mergeAll(fixture.layer, pages, membership, player) },
    Effect.gen(function* () {
      const root = yield* TestHost.mount(RoutedApplicationNoDeps, props)
      yield* TestHost.settle
      const client = yield* PlayerClient
      yield* client.controller.playAll([track])
      yield* TestHost.settle
      yield* openRetirementPlayer(root)
      expect(metadata.at(-1)?.title).toBe(track.title)
      const metadataStart = metadata.length
      Locator.fire(root.get(Locator.attr('aria-label', 'Add to favorites')), 'click')
      yield* TestHost.settle
      expect(reads).toBe(2)
      expect(writes).toBe(1)
      expect(verified).toBe(false)
      expect(root.model()?.membershipPrincipalKnown).toBe(false)
      expect(root.model()?.membershipPrincipalId).toBeNull()
      expect(root.text()).not.toContain(track.title)
      expect(metadata.length).toBeGreaterThan(metadataStart)
      expect(metadata.at(-1)).toBeNull()
      expect(metadata.slice(metadataStart).every((value) => value === null)).toBe(true)
      verification.resolve(
        Response.json({ ...readerDocument('/about'), principal: null, principalKnown: false }),
      )
      yield* TestHost.settle
      expect(verified).toBe(true)
      expect(writes).toBe(1)
    }),
  )
})
