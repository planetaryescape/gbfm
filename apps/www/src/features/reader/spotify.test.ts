import { Component, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { HtmlLocator, HtmlPlay } from '@effect/ui/html/testing'
import { Locator, TestHost } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import { MicroPostScreenResponse } from '@gbfm/api/post'
import { Context, Deferred, Effect, Layer, Schema } from 'effect'
import { HttpClient } from 'effect/http'

import { SpotifyConnection } from '../../spotify/connection'
import { SpotifyActions } from '../spotify/actions'
import { PerformSpotify, ReadSpotifyStatus } from '../spotify/commands'
import { SpotifyProvider } from '../spotify/provider'
import { props, screen } from './fixtures.test-support'
import { ReaderPage } from './page'

const firstUrl = 'https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv'

const secondUrl = 'https://open.spotify.com/album/7aDBFWp72Pz4NZEtVBANi9'

const music = (url: string) => ({
  entity: {
    id: url,
    type: 'album',
    title: 'The record',
    artistNames: ['Artist'],
    coverImageUrl: null,
  },
  links: [{ platform: 'spotify', url }],
})

const initial = screen('b')

const reply = screen('reply')

const next = screen('c')

const initialPage = {
  ...props('b'),
  screen: Schema.decodeUnknownSync(MicroPostScreenResponse)({
    ...initial,
    post: { ...initial.post, music: music(firstUrl), replyCount: 1 },
    replies: [{ ...reply.post, music: music(secondUrl) }],
  }),
}

const nextPage = {
  ...props('c', 1),
  screen: Schema.decodeUnknownSync(MicroPostScreenResponse)({
    ...next,
    post: { ...next.post, music: music(secondUrl) },
  }),
}

const SpotifyTestMessage = UiSchema.TaggedEnum({
  ClickedChangeReader: {},
  ClickedUnmountReader: {},
})

const SpotifyTestApplication = Html.component({
  name: 'SpotifyTestApplication',
  model: Schema.Struct({ alternate: Schema.Boolean, mounted: Schema.Boolean }),
  message: SpotifyTestMessage,
})
  .make({
    init: () => ({ alternate: false, mounted: true }),
    update: {
      ClickedChangeReader: ($) => $.evolve({ alternate: true }),
      ClickedUnmountReader: ($) => $.evolve({ mounted: false }),
    },
    view: (h, model) =>
      SpotifyProvider(h, {
        props: { identity: 'anonymous' },
        view: () =>
          h.div.children(
            h.button
              .on('click', SpotifyTestMessage.ClickedChangeReader())
              .children('Change reader destination'),
            h.button
              .on('click', SpotifyTestMessage.ClickedUnmountReader())
              .children('Unmount reader'),
            model.mounted && ReaderPage(h, { props: model.alternate ? nextPage : initialPage }),
            h.section
              .attr('data-testid', 'persistent')
              .children(SpotifyActions(h, { key: 'persistent', props: { url: firstUrl } })),
          ),
      }),
  })
  .pipe(Component.provide(Layer.mergeAll(PerformSpotify.layer, ReadSpotifyStatus.layer)))

class SpotifyFixture extends Context.Service<
  SpotifyFixture,
  {
    readonly gate: Deferred.Deferred<string>
    readonly operations: Array<{ readonly action: string; readonly url: string }>
  }
>()('reader/test/SpotifyFixture') {}

const fixtureLayer = Layer.effect(
  SpotifyFixture,
  Effect.gen(function* () {
    const gate = yield* Deferred.make<string>()

    return { gate, operations: [] }
  }),
)

const connectionLayer = Layer.effect(
  SpotifyConnection,
  Effect.map(SpotifyFixture, (fixture) => ({
    status: Effect.succeed({ connected: true, name: 'Listener' }),
    playback: (input) =>
      Effect.sync(() => fixture.operations.push(input)).pipe(
        Effect.andThen(Deferred.await(fixture.gate)),
      ),
    connect: Effect.void,
    disconnect: Effect.succeed({ connected: false, name: '' }),
    completeCallback: Effect.void,
  })),
)

const testLayer = Layer.mergeAll(
  TestHost.layer(),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.die('Uncommitted reader content must not request HTTP data')),
  ),
  connectionLayer.pipe(Layer.provideMerge(fixtureLayer)),
)

it.layer(testLayer, { buildPerTest: true })('global Spotify ownership around the reader', (it) => {
  it.effect(
    'keeps one busy operation across cards, reader destination changes and reader unmount',
    () =>
      Effect.gen(function* () {
        const fixture = yield* SpotifyFixture
        const play = yield* HtmlPlay.make(SpotifyTestApplication, {})
        const playButton = HtmlLocator.role('button', { name: 'Play on Spotify' })
        const first = Locator.inside(Locator.attr('data-reader-article'), playButton)
        const second = Locator.inside(Locator.attr('id', 'replies'), playButton)
        const persistent = Locator.inside(Locator.testId('persistent'), playButton)
        yield* play.expect(first).toBeDisabled(false)
        yield* play.expect(second).toBeDisabled(false)
        yield* play.click(first)
        yield* play.expect(first).toBeDisabled()
        yield* play.expect(second).toBeDisabled()
        yield* play.expect(persistent).toBeDisabled()
        yield* play.click('Change reader destination')
        yield* play.expect(HtmlLocator.role('heading', { name: 'Tweet c' })).toExist()
        yield* play.expect(first).toBeDisabled()
        yield* play.click('Unmount reader')
        yield* play.expect(Locator.attr('data-reader-article')).toBeAbsent()
        yield* play.expect(persistent).toBeDisabled()
        assert.deepStrictEqual(fixture.operations, [{ action: 'play', url: firstUrl }])
        yield* Deferred.succeed(fixture.gate, 'Playing')
        yield* play.expect(persistent).toBeDisabled(false)
        yield* play
          .expect(Locator.inside(Locator.testId('persistent'), HtmlLocator.role('status')))
          .toHaveText('Playing')
      }),
  )
})
