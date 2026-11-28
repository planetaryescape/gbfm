import { UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { JourneyExporter, observabilityLayer } from '@gbfm/observability'
import type { NowPlayingMetadata, QueueTrackType } from '@gbfm/player'
import { Context, Effect, Layer, ManagedRuntime, Predicate, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { makePlayerClientLayer, PlayerClient, type AudioPort } from '../../player/runtime'
import { initialModel, PlayerControlMessage, PlayerProviderMessage } from './domain'
import { MiniPlayer } from './mini-player'
import { presentedSnapshot } from './privacy'
import { PlayerProvider, playerCommandsLayer } from './provider'
import { runWithLayer } from './testing'

const privateTrack: QueueTrackType = {
  id: 'privacy-fixture-private',
  slug: 'privacy-fixture-private',
  title: 'Fixture A private title',
  url: 'https://cdn.fixture.test/user-content/private/fixture-a/audio/song.wav',
  thumbnailUrl: 'https://cdn.fixture.test/user-content/private/fixture-a/artwork/cover.webp',
  type: 'mix',
}

const publicTrack: QueueTrackType = {
  id: 'privacy-fixture-public',
  slug: 'privacy-fixture-public',
  title: 'Fixture public title',
  url: 'https://cdn.fixture.test/public/song.wav',
  thumbnailUrl: null,
  type: 'mix',
}

const queuedPrivateTrack = {
  ...privateTrack,
  id: 'privacy-fixture-private-queued',
  title: 'Fixture A queued private title',
  url: 'https://cdn.fixture.test/user-content/private/fixture-a/audio/queued.wav',
}

class PrivateAudioPort extends EventTarget implements AudioPort {
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

const Probe = Html.component({
  name: 'PrivatePlayerProbe',
  model: Schema.Null,
  message: PlayerControlMessage,
  reads: { provider: PlayerProvider },
}).make({
  init: () => null,
  update: ($, message) => $.send(PlayerProvider, message),
  view: (h) =>
    h.div.children(
      h.button
        .attr('aria-label', 'Play public fixture')
        .on(
          'click',
          PlayerProviderMessage.RequestedPlayAll({ tracks: [publicTrack, privateTrack] }),
        ),
      h.button
        .attr('aria-label', 'Seek fixture')
        .on('click', PlayerProviderMessage.RequestedSeek({ seconds: 42 })),
      h.button
        .attr('aria-label', 'Fixture volume')
        .on('click', PlayerProviderMessage.RequestedVolume({ volume: 30 })),
      h.button
        .attr('aria-label', 'Fixture mute')
        .on('click', PlayerProviderMessage.RequestedToggleMute()),
      h.button
        .attr('aria-label', 'Play private fixture')
        .on(
          'click',
          PlayerProviderMessage.RequestedPlayAll({ tracks: [privateTrack, publicTrack] }),
        ),
      h.button.attr('aria-label', 'Play private queue fixture').on(
        'click',
        PlayerProviderMessage.RequestedPlayAll({
          tracks: [privateTrack, queuedPrivateTrack, publicTrack],
        }),
      ),
      h.button
        .attr('aria-label', 'Play queued private fixture')
        .on(
          'click',
          PlayerProviderMessage.RequestedPlayAll({ tracks: [queuedPrivateTrack, publicTrack] }),
        ),
      h.output
        .attr('data-testid', 'queue')
        .children(h.reads.provider.snapshot.queue.tracks.map((track) => track.title).join(', ')),
    ),
})

const Principal = Schema.Struct({
  principalId: Schema.NullOr(Schema.String),
  principalKnown: Schema.Boolean,
  authorizationSuspended: Schema.optional(Schema.Boolean),
})

const AppMessage = UiSchema.TaggedEnum({ ChangedPrincipal: Principal.fields })

const App = Html.component({
  name: 'PrivatePlayerApp',
  props: Principal,
  model: Principal,
  message: AppMessage,
}).make({
  init: ($) => $.props,
  update: ($, message) =>
    $.evolve({
      principalId: message.principalId,
      principalKnown: message.principalKnown,
      authorizationSuspended: message.authorizationSuspended,
    }),
  view: (h, principal) =>
    PlayerProvider(h, {
      key: 'stable',
      props: { ...principal, returnTo: '/mixes' },
      view: () => h.main.children(Probe(h, {}), MiniPlayer(h, {})),
    }),
})

const fixture = (restore = false, holdGrant = false) => {
  const values = new Map<string, string>()

  if (restore)
    values.set(
      'gbfm-audio-queue.json',
      JSON.stringify({
        tracks: [privateTrack, publicTrack],
        currentIndex: 0,
      }),
    )
  const instances: Array<PrivateAudioPort> = []
  let grants = 0
  let controllerAcquisitions = 0
  let allowed = !restore
  const gate = Promise.withResolvers<{ readonly ok: boolean }>()
  const metadata: Array<NowPlayingMetadata | null> = []
  let sessions = 0
  let disposedSessions = 0

  const storage: Storage = {
    get length() {
      return values.size
    },
    clear: () => {
      values.clear()
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }

  const base = makePlayerClientLayer({
    isolatePrivateMedia: true,
    storage: () => storage,
    deliverPlay: () => Effect.void,
    reporter: {},
    setMediaSessionMetadata: (value) => {
      metadata.push(value)
    },
    createAudio: () => {
      const audio = new PrivateAudioPort()
      instances.push(audio)

      return audio
    },
    createPreview: (_url, onDenied) => {
      sessions++
      let disposed = false

      return {
        ensure: async () => {
          grants++

          if (holdGrant) return gate.promise

          if (!allowed) onDenied()

          return { ok: allowed }
        },
        dispose: () => {
          if (disposed) return
          disposed = true
          disposedSessions++
        },
      }
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

  const runtime = ManagedRuntime.make(
    Layer.effect(
      PlayerClient,
      Effect.gen(function* () {
        const client = yield* PlayerClient
        controllerAcquisitions++

        return client
      }),
    ).pipe(Layer.provide(base)),
  )

  const client = Layer.effect(
    PlayerClient,
    Effect.map(runtime.contextEffect, (context) => Context.get(context, PlayerClient)),
  )

  return {
    instances,
    metadata,
    activeSessions: () => sessions - disposedSessions,
    releaseGrant: (ok: boolean) => {
      gate.resolve({ ok })
    },
    runtime,
    layer: Layer.merge(TestHost.layer(), playerCommandsLayer.pipe(Layer.provide(client))),
    grants: () => grants,
    deny: () => {
      allowed = false
    },
    allow: () => {
      allowed = true
    },
    acquisitions: () => controllerAcquisitions,
    access: () =>
      runtime.runPromise(
        Effect.flatMap(PlayerClient, ({ privateAccess }) => {
          if (!privateAccess)
            return Effect.die(new Error('Isolated player fixture requires private playback access'))

          return Effect.sync(privateAccess.getSnapshot)
        }),
      ),
    snapshot: () =>
      runtime.runPromise(Effect.map(PlayerClient, ({ controller }) => controller.getSnapshot())),
  }
}

const artworkSources = (
  root: TestHost.TestRoot<typeof Principal.Type, typeof AppMessage.Type, never>,
) =>
  root
    .all(Locator.tag('img'))
    .map((image) =>
      Predicate.isTagged(image, 'Element')
        ? (image.attrs['data-private-media-src'] ?? image.attrs.src)
        : '',
    )

describe('native private player principal isolation', () => {
  it('explicit suspension masks an already authorized private current and queue before a command or access update runs', () => {
    const model = {
      ...initialModel,
      snapshot: {
        ...initialModel.snapshot,
        queue: {
          tracks: [privateTrack, queuedPrivateTrack, publicTrack],
          current: privateTrack,
          currentIndex: 0,
        },
      },
      privateAccess: {
        principalId: 'fixture-a',
        principalKnown: true,
        revision: 7,
        authorizedUrls: [privateTrack.url, queuedPrivateTrack.url],
      },
    }

    const visible = presentedSnapshot(model, {
      principalId: 'fixture-a',
      principalKnown: true,
      returnTo: '/mixes',
      authorizationSuspended: true,
    })

    expect(visible.queue).toEqual({
      tracks: [publicTrack],
      current: null,
      currentIndex: -1,
    })
    expect(JSON.stringify(visible)).not.toContain(privateTrack.title)
    expect(JSON.stringify(visible)).not.toContain(queuedPrivateTrack.url)
    expect(model.privateAccess.authorizedUrls).toEqual([privateTrack.url, queuedPrivateTrack.url])
  })

  it('explicit suspension clears private current and queue, advances authority and requires a fresh intent and grant after verification', async () => {
    const f = fixture()

    try {
      await runWithLayer(
        f.layer,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(App, {
            principalId: 'fixture-a',
            principalKnown: true,
          })

          yield* TestHost.settle
          Locator.fire(root.get(Locator.attr('aria-label', 'Play queued private fixture')), 'click')
          yield* TestHost.settle
          Locator.fire(root.get(Locator.attr('aria-label', 'Play private queue fixture')), 'click')
          yield* TestHost.settle
          expect(root.text()).toContain(privateTrack.title)
          expect(root.text()).toContain(queuedPrivateTrack.title)
          const before = yield* Effect.promise(f.access)
          const source = f.instances.at(-1)
          const metadataStart = f.metadata.length
          const grants = f.grants()
          expect(before.authorizedUrls).toContain(privateTrack.url)
          root.send(
            AppMessage.ChangedPrincipal({
              principalId: 'fixture-a',
              principalKnown: true,
              authorizationSuspended: true,
            }),
          )
          yield* TestHost.settle
          expect(root.text()).not.toContain(privateTrack.title)
          expect(root.text()).not.toContain(queuedPrivateTrack.title)
          expect(artworkSources(root)).not.toContain(privateTrack.thumbnailUrl)
          expect(source).toMatchObject({ src: '', paused: true })
          expect(f.activeSessions()).toBe(0)
          expect(f.metadata.slice(metadataStart)).toContain(null)
          expect(
            f.metadata.slice(metadataStart).some((value) => value?.title === privateTrack.title),
          ).toBe(false)
          const suspended = yield* Effect.promise(f.access)
          expect(suspended).toEqual({
            principalId: null,
            principalKnown: false,
            revision: before.revision + 1,
            authorizedUrls: [],
          })
          expect((yield* Effect.promise(f.snapshot)).queue.tracks.map((track) => track.id)).toEqual(
            [publicTrack.id],
          )
          root.send(
            AppMessage.ChangedPrincipal({
              principalId: 'fixture-a',
              principalKnown: true,
              authorizationSuspended: false,
            }),
          )
          yield* TestHost.settle
          expect((yield* Effect.promise(f.access)).authorizedUrls).toEqual([])
          expect(f.grants()).toBe(grants)
          expect(root.text()).not.toContain(privateTrack.title)
          Locator.fire(root.get(Locator.attr('aria-label', 'Play private fixture')), 'click')
          yield* TestHost.settle
          expect(f.grants()).toBeGreaterThan(grants)
          expect(root.text()).toContain(privateTrack.title)
          expect(f.metadata.at(-1)?.title).toBe(privateTrack.title)
          expect(f.acquisitions()).toBe(1)
        }),
      )
    } finally {
      await f.runtime.dispose()
    }
  })

  it.each(['before verification', 'after verification'])(
    'explicit suspension fences an old successful private grant resolving %s without replaying it',
    async (arrival) => {
      const f = fixture(true, true)

      try {
        await runWithLayer(
          f.layer,
          Effect.gen(function* () {
            const root = yield* TestHost.mount(App, {
              principalId: 'fixture-a',
              principalKnown: true,
            })

            yield* TestHost.settle
            yield* Effect.promise(async () => {
              await expect.poll(f.grants).toBeGreaterThan(0)
            })
            const revision = (yield* Effect.promise(f.access)).revision
            root.send(
              AppMessage.ChangedPrincipal({
                principalId: null,
                principalKnown: false,
                authorizationSuspended: true,
              }),
            )
            yield* TestHost.settle
            expect(yield* Effect.promise(f.access)).toMatchObject({
              principalId: null,
              principalKnown: false,
              revision: revision + 1,
              authorizedUrls: [],
            })

            if (arrival === 'before verification') {
              f.releaseGrant(true)
              yield* TestHost.settle
            }

            root.send(
              AppMessage.ChangedPrincipal({
                principalId: 'fixture-a',
                principalKnown: true,
                authorizationSuspended: false,
              }),
            )
            yield* TestHost.settle

            if (arrival === 'after verification') {
              f.releaseGrant(true)
              yield* TestHost.settle
            }

            expect(root.text()).not.toContain(privateTrack.title)
            expect(root.text()).toContain(publicTrack.title)
            expect(artworkSources(root)).not.toContain(privateTrack.thumbnailUrl)
            expect((yield* Effect.promise(f.access)).authorizedUrls).toEqual([])
            expect(f.metadata.some((value) => value?.title === privateTrack.title)).toBe(false)
            expect(f.instances.every((audio) => audio.src !== privateTrack.url)).toBe(true)
            expect(f.activeSessions()).toBe(0)
            expect(f.grants()).toBe(1)
            expect(f.acquisitions()).toBe(1)
          }),
        )
      } finally {
        f.releaseGrant(false)
        await f.runtime.dispose()
      }
    },
  )

  it('explicit suspension preserves public source, clock, playing state, volume and metadata while removing private queue entries', async () => {
    const f = fixture()

    try {
      await runWithLayer(
        f.layer,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(App, {
            principalId: 'fixture-a',
            principalKnown: true,
          })

          yield* TestHost.settle

          for (const label of [
            'Play public fixture',
            'Seek fixture',
            'Fixture volume',
            'Fixture mute',
          ]) {
            Locator.fire(root.get(Locator.attr('aria-label', label)), 'click')
            yield* TestHost.settle
          }

          const source = f.instances.at(-1)
          root.send(
            AppMessage.ChangedPrincipal({
              principalId: 'fixture-a',
              principalKnown: true,
              authorizationSuspended: true,
            }),
          )
          yield* TestHost.settle
          expect(f.instances.at(-1)).toBe(source)
          expect(source).toMatchObject({
            src: publicTrack.url,
            currentTime: 42,
            volume: 0.3,
            muted: true,
            paused: false,
          })
          expect(yield* Effect.promise(f.access)).toMatchObject({
            principalId: null,
            principalKnown: false,
            authorizedUrls: [],
          })
          expect((yield* Effect.promise(f.snapshot)).queue.tracks.map((track) => track.id)).toEqual(
            [publicTrack.id],
          )
          expect(root.text()).toContain(publicTrack.title)
          expect(root.text()).not.toContain(privateTrack.title)
          expect(f.metadata.at(-1)?.title).toBe(publicTrack.title)
          expect(f.grants()).toBe(0)
          expect(f.instances).toHaveLength(1)
          expect(f.acquisitions()).toBe(1)
        }),
      )
    } finally {
      await f.runtime.dispose()
    }
  })

  it('explicit suspension releases an initial unknown-authority waiter without letting verification replay its restored private queue', async () => {
    const f = fixture(true)

    try {
      await runWithLayer(
        f.layer,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(App, {
            principalId: null,
            principalKnown: false,
          })

          yield* TestHost.settle
          yield* Effect.promise(async () => {
            await expect.poll(() => f.instances.length).toBeGreaterThan(0)
          })
          expect(f.grants()).toBe(0)
          expect(f.activeSessions()).toBe(0)
          root.send(
            AppMessage.ChangedPrincipal({
              principalId: null,
              principalKnown: false,
              authorizationSuspended: true,
            }),
          )
          yield* TestHost.settle
          expect(f.activeSessions()).toBe(0)
          expect((yield* Effect.promise(f.snapshot)).queue.tracks.map((track) => track.id)).toEqual(
            [publicTrack.id],
          )
          root.send(
            AppMessage.ChangedPrincipal({
              principalId: 'fixture-a',
              principalKnown: true,
              authorizationSuspended: false,
            }),
          )
          yield* TestHost.settle
          expect(f.grants()).toBe(0)
          expect((yield* Effect.promise(f.access)).authorizedUrls).toEqual([])
          expect(root.text()).not.toContain(privateTrack.title)
          expect(f.metadata.some((value) => value?.title === privateTrack.title)).toBe(false)
          expect(f.acquisitions()).toBe(1)
        }),
      )
    } finally {
      await f.runtime.dispose()
    }
  })

  it('a private play requested while explicitly suspended cannot wait for verification and replay itself', async () => {
    const f = fixture()

    try {
      await runWithLayer(
        f.layer,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(App, {
            principalId: 'fixture-a',
            principalKnown: true,
          })

          yield* TestHost.settle
          root.send(
            AppMessage.ChangedPrincipal({
              principalId: null,
              principalKnown: false,
              authorizationSuspended: true,
            }),
          )
          yield* TestHost.settle
          Locator.fire(root.get(Locator.attr('aria-label', 'Play private fixture')), 'click')
          yield* TestHost.settle
          expect(f.grants()).toBe(0)
          expect(f.activeSessions()).toBe(0)
          expect((yield* Effect.promise(f.access)).authorizedUrls).toEqual([])
          root.send(
            AppMessage.ChangedPrincipal({
              principalId: 'fixture-a',
              principalKnown: true,
              authorizationSuspended: false,
            }),
          )
          yield* TestHost.settle
          expect(f.grants()).toBe(0)
          expect((yield* Effect.promise(f.access)).authorizedUrls).toEqual([])
          expect(f.instances.every((audio) => audio.src !== privateTrack.url)).toBe(true)
          expect((yield* Effect.promise(f.snapshot)).queue.tracks.map((track) => track.id)).toEqual(
            [publicTrack.id],
          )
          expect(root.text()).not.toContain(privateTrack.title)
          expect(root.text()).toContain(publicTrack.title)
          expect(f.metadata.some((value) => value?.title === privateTrack.title)).toBe(false)
          expect(f.acquisitions()).toBe(1)
        }),
      )
    } finally {
      await f.runtime.dispose()
    }
  })

  it('publishes previously denied private playback only after a fresh successful retry grant', async () => {
    const f = fixture(true)

    try {
      await runWithLayer(
        f.layer,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(App, {
            principalId: 'fixture-a',
            principalKnown: true,
          })

          yield* TestHost.settle
          yield* Effect.promise(async () => {
            await expect.poll(f.grants).toBeGreaterThan(0)
          })
          yield* TestHost.settle
          expect(root.text()).not.toContain(privateTrack.title)
          expect(f.metadata.every((value) => value === null)).toBe(true)
          f.allow()
          yield* Effect.promise(() =>
            f.runtime.runPromise(Effect.flatMap(PlayerClient, ({ controller }) => controller.play)),
          )
          yield* TestHost.settle
          expect(root.text()).toContain(privateTrack.title)
          expect(f.metadata.at(-1)?.title).toBe(privateTrack.title)
          expect(f.instances.at(-1)).toMatchObject({ src: privateTrack.url, paused: false })
          expect(f.acquisitions()).toBe(1)
        }),
      )
    } finally {
      await f.runtime.dispose()
    }
  })
  it('keeps same-A private playback through a transient unknown principal without a second controller', async () => {
    const f = fixture()

    try {
      await runWithLayer(
        f.layer,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(App, {
            principalId: 'fixture-a',
            principalKnown: true,
          })

          yield* TestHost.settle
          Locator.fire(root.get(Locator.attr('aria-label', 'Play private fixture')), 'click')
          yield* TestHost.settle
          const source = f.instances.at(-1)
          expect(source?.src).toBe(privateTrack.url)
          expect(source?.paused).toBe(false)
          expect(f.metadata.at(-1)?.title).toBe(privateTrack.title)
          const grants = f.grants()
          root.send(AppMessage.ChangedPrincipal({ principalId: null, principalKnown: false }))
          yield* TestHost.settle
          expect(source?.paused).toBe(false)
          expect(source?.src).toBe(privateTrack.url)
          root.send(AppMessage.ChangedPrincipal({ principalId: 'fixture-a', principalKnown: true }))
          yield* TestHost.settle
          expect(root.text()).toContain(privateTrack.title)
          expect(source?.paused).toBe(false)
          expect(f.grants()).toBe(grants)
          expect(f.instances).toHaveLength(1)
          expect(f.acquisitions()).toBe(1)
        }),
      )
    } finally {
      await f.runtime.dispose()
    }
  })

  it.each(['fixture-b', null])(
    'hides A metadata and stops its private source after confirmed %s',
    async (principalId) => {
      const f = fixture()

      try {
        await runWithLayer(
          f.layer,
          Effect.gen(function* () {
            const root = yield* TestHost.mount(App, {
              principalId: 'fixture-a',
              principalKnown: true,
            })

            yield* TestHost.settle
            Locator.fire(root.get(Locator.attr('aria-label', 'Play private fixture')), 'click')
            yield* TestHost.settle
            expect(root.text()).toContain(privateTrack.title)
            expect(artworkSources(root)).toContain(privateTrack.thumbnailUrl)
            const source = f.instances.at(-1)
            f.deny()
            root.send(AppMessage.ChangedPrincipal({ principalId, principalKnown: true }))
            yield* TestHost.settle
            expect.soft(root.text()).not.toContain(privateTrack.title)
            expect.soft(artworkSources(root)).not.toContain(privateTrack.thumbnailUrl)
            expect.soft(source?.paused).toBe(true)
            expect.soft(source?.src).toBe('')
            expect(f.metadata).toContain(null)
            expect(f.metadata.at(-1)?.title).not.toBe(privateTrack.title)
            expect(f.activeSessions()).toBe(0)
            expect(root.text()).toContain(publicTrack.title)
            expect(f.acquisitions()).toBe(1)
          }),
        )
      } finally {
        await f.runtime.dispose()
      }
    },
  )

  it('does not present restored A private metadata under B when its fresh preview grant is denied', async () => {
    const f = fixture(true)

    try {
      await runWithLayer(
        f.layer,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(App, {
            principalId: 'fixture-b',
            principalKnown: true,
          })

          yield* TestHost.settle
          yield* Effect.promise(async () => {
            await expect.poll(f.grants).toBeGreaterThan(0)
          })
          yield* TestHost.settle
          expect(f.instances.every((audio) => audio.src === '' && audio.paused)).toBe(true)
          expect(f.metadata.every((metadata) => metadata === null)).toBe(true)
          expect.soft(root.text()).not.toContain(privateTrack.title)
          expect.soft(artworkSources(root)).not.toContain(privateTrack.thumbnailUrl)
          expect(root.text()).toContain(publicTrack.title)
          expect(f.acquisitions()).toBe(1)
        }),
      )
    } finally {
      await f.runtime.dispose()
    }
  })

  it.each([true, false])(
    'withholds restored private DOM and Media Session metadata until a fresh grant resolves %s',
    async (ok) => {
      const f = fixture(true, true)

      try {
        await runWithLayer(
          f.layer,
          Effect.gen(function* () {
            const root = yield* TestHost.mount(App, {
              principalId: 'fixture-b',
              principalKnown: true,
            })

            yield* TestHost.settle
            yield* Effect.promise(async () => {
              await expect.poll(f.grants).toBeGreaterThan(0)
            })
            yield* TestHost.settle
            expect(root.text()).not.toContain(privateTrack.title)
            expect(artworkSources(root)).not.toContain(privateTrack.thumbnailUrl)
            expect(f.instances.every((audio) => audio.src === '')).toBe(true)
            expect(f.metadata.every((value) => value === null)).toBe(true)
            f.releaseGrant(ok)
            yield* TestHost.settle
            yield* Effect.promise(async () => {
              await expect
                .poll(() => f.metadata.some((value) => value?.title === privateTrack.title))
                .toBe(ok)
            })
            yield* TestHost.settle

            if (ok) {
              expect(root.text()).toContain(privateTrack.title)
              expect(artworkSources(root)).toContain(privateTrack.thumbnailUrl)
              expect(f.instances.at(-1)?.src).toBe(privateTrack.url)
            } else {
              expect(root.text()).not.toContain(privateTrack.title)
              expect(f.instances.every((audio) => audio.src === '')).toBe(true)
            }

            expect(f.acquisitions()).toBe(1)
          }),
        )
      } finally {
        f.releaseGrant(false)
        await f.runtime.dispose()
      }
    },
  )

  it('fences a pending A grant that resolves after confirmed B and releases its preview session', async () => {
    const f = fixture(true, true)

    try {
      await runWithLayer(
        f.layer,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(App, {
            principalId: 'fixture-a',
            principalKnown: true,
          })

          yield* TestHost.settle
          yield* Effect.promise(async () => {
            await expect.poll(f.grants).toBeGreaterThan(0)
          })
          root.send(AppMessage.ChangedPrincipal({ principalId: 'fixture-b', principalKnown: true }))
          yield* TestHost.settle
          f.releaseGrant(true)
          yield* TestHost.settle
          expect(root.text()).not.toContain(privateTrack.title)
          expect(artworkSources(root)).not.toContain(privateTrack.thumbnailUrl)
          expect(f.metadata.some((value) => value?.title === privateTrack.title)).toBe(false)
          expect(f.instances.every((audio) => audio.src !== privateTrack.url)).toBe(true)
          expect(f.activeSessions()).toBe(0)
          expect(root.text()).toContain(publicTrack.title)
          expect(f.acquisitions()).toBe(1)
        }),
      )
    } finally {
      f.releaseGrant(false)
      await f.runtime.dispose()
    }
  })

  it('retains the public source, position and volume while dropping only queued private tracks on identity change', async () => {
    const f = fixture()

    try {
      await runWithLayer(
        f.layer,
        Effect.gen(function* () {
          const root = yield* TestHost.mount(App, {
            principalId: 'fixture-a',
            principalKnown: true,
          })

          yield* TestHost.settle

          for (const label of [
            'Play public fixture',
            'Seek fixture',
            'Fixture volume',
            'Fixture mute',
          ]) {
            Locator.fire(root.get(Locator.attr('aria-label', label)), 'click')
            yield* TestHost.settle
          }

          const source = f.instances.at(-1)
          expect(source).toMatchObject({
            src: publicTrack.url,
            currentTime: 42,
            volume: 0.3,
            muted: true,
            paused: false,
          })
          root.send(AppMessage.ChangedPrincipal({ principalId: 'fixture-b', principalKnown: true }))
          yield* TestHost.settle
          expect(f.instances.at(-1)).toBe(source)
          expect(source).toMatchObject({
            src: publicTrack.url,
            currentTime: 42,
            volume: 0.3,
            muted: true,
            paused: false,
          })
          expect(root.text()).toContain(publicTrack.title)
          expect(root.text()).not.toContain(privateTrack.title)
          expect(f.metadata.at(-1)?.title).toBe(publicTrack.title)
          expect(f.grants()).toBe(0)
          expect(f.acquisitions()).toBe(1)
          expect(f.instances).toHaveLength(1)
        }),
      )
    } finally {
      await f.runtime.dispose()
    }
  })
})
