import { JourneyExporter, observabilityLayer, type Observability } from '@gbfm/observability'
import type { NowPlayingMetadata, QueueTrackType } from '@gbfm/player'
import { Effect, Layer } from 'effect'

import { browserPageLayer } from '../src/app/page-query'
import type { AppBootstrap } from '../src/app/routed-application'
import { PageDocument } from '../src/domain/page'
import { playerCommandsLayer } from '../src/features/player/provider'
import type { LoadMembership, SaveMembership } from '../src/features/public-actions/commands'
import { page, track } from '../src/features/public-actions/integration.test-support'
import type { AudioPort, BrowserDependencies, PlayerClient } from '../src/player/runtime'

export const recoveryPublicTrack: QueueTrackType = { ...track }

export const recoveryPrivateTrack: QueueTrackType = {
  ...track,
  id: 'private-recovery-fixture',
  slug: 'private-recovery-fixture',
  title: 'Private recovery fixture title',
  thumbnailUrl: 'https://cdn.fixture.test/user-content/private/account-a/artwork/cover.webp',
  url: 'https://cdn.fixture.test/user-content/private/account-a/audio/current.mp3',
}

export class RecoveryAudio extends EventTarget implements AudioPort {
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

export const recoveryPage = (
  path = '/mixes/audio-a',
  principalId: string | null = 'account-a',
  principalKnown = true,
): PageDocument => {
  const document = page(path, principalId, undefined, principalKnown)

  const show = {
    id: 'show-a',
    slug: 'show-a',
    title: 'Recovery fixture show',
    description: '',
    thumbnailUrl: null,
    bannerImageUrl: null,
    content: '',
    draft: false,
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    hosts: [],
  }

  return PageDocument.make({
    ...document,
    url: new URL(path, 'https://preview.example.test').href,
    shows: path.startsWith('/shows/')
      ? { shows: [show], selectedSlug: show.slug, episodes: null }
      : null,
    publicAction: path.startsWith('/shows/')
      ? { target: { kind: 'show', id: show.id }, path, state: 'inactive' }
      : document.publicAction,
  })
}

export const recoveryFixtureBuilder =
  <R>(
    makeFixture: (start: string) => {
      readonly props: AppBootstrap
      readonly layer: Layer.Layer<R>
    },
    makeClient: (
      dependencies: BrowserDependencies,
    ) => Layer.Layer<PlayerClient, never, Observability>,
  ) =>
  (
    start: string,
    fetchPage: typeof fetch,
    membership: Layer.Layer<LoadMembership | SaveMembership>,
  ) => {
    const fixture = makeFixture(start)
    const metadata: Array<NowPlayingMetadata | null> = []
    const audio: Array<RecoveryAudio> = []
    let grants = 0

    const client = makeClient({
      isolatePrivateMedia: true,
      storage: () => undefined,
      deliverPlay: () => Effect.void,
      reporter: {},
      createAudio: () => {
        const instance = new RecoveryAudio()
        audio.push(instance)

        return instance
      },
      createPreview: () => ({
        ensure: async () => {
          grants++

          return { ok: true }
        },
        dispose: () => {},
      }),
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

    return {
      props: { ...fixture.props, identity: { known: true, principalId: 'account-a', epoch: 0 } },
      layer: Layer.mergeAll(
        fixture.layer,
        browserPageLayer(fixture.props.url, fixture.props.realm, fetchPage),
        membership,
        playerCommandsLayer.pipe(Layer.provideMerge(client)),
      ),
      metadata,
      audio,
      grants: () => grants,
    }
  }
