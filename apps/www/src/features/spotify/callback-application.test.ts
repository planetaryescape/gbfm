import { HtmlServer } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { SpotifyConnection, SpotifyConnectionError } from '../../spotify/connection'
import { consumeCallback } from '../../spotify/runtime'
import { runWithLayer } from '../player/testing'
import { SpotifyCallback } from './actions'
import {
  makeSpotifyCallbackProps,
  SpotifyCallbackApplication,
  SpotifyCallbackApplicationProps,
} from './callback-application'
import { spotifyCallbackPath, spotifyCallbackAliasPath } from './callback-url'
import { PerformSpotify } from './commands'

const code = 'callback-code-must-remain-transient'

const state = 'callback-state-must-remain-transient'

const rawCallback = `https://goosebumps.fm/spotify/callback?code=${code}&state=${state}`

const fixture = (valid: boolean, callbackUrl: string) => {
  const values = new Map([
    ['gbfm:spotify-oauth-state', valid ? state : 'a-different-state'],
    ['gbfm:spotify-return-path', '/editorial/fixture?listen=1#record'],
  ])

  const exchanged: Array<string> = []
  const redirected: Array<string> = []
  let completions = 0
  let statusReads = 0

  const layer = PerformSpotify.layer.pipe(
    Layer.provide(
      Layer.succeed(SpotifyConnection, {
        status: Effect.sync(() => {
          statusReads++

          return { connected: false, name: '' }
        }),
        connect: Effect.void,
        disconnect: Effect.succeed({ connected: false, name: '' }),
        playback: () => Effect.succeed(''),
        completeCallback: Effect.gen(function* () {
          completions++

          const callback = consumeCallback(new URL(callbackUrl), {
            getItem: (key) => values.get(key) ?? null,
            removeItem: (key) => {
              values.delete(key)
            },
          })

          const validated = yield* callback
            ? Effect.succeed(callback)
            : Effect.fail(
                new SpotifyConnectionError({
                  message:
                    'Spotify authorization is missing, expired, or invalid. Connect again from settings.',
                }),
              )

          exchanged.push(validated.code)
          redirected.push(validated.destination)
        }),
      }),
    ),
  )

  return {
    layer,
    values,
    exchanged,
    redirected,
    completions: () => completions,
    statusReads: () => statusReads,
  }
}

const props = makeSpotifyCallbackProps({ principal: null, principalKnown: true })

describe.each([spotifyCallbackPath, spotifyCallbackAliasPath])(
  'standalone native Spotify callback application at %s',
  (path) => {
    const callbackUrl = `https://goosebumps.fm${path}?code=${code}&state=${state}`
    const pathFixture = (valid = true) => fixture(valid, callbackUrl)

    it('constructs only safe bootstrap fields and rejects a callback URL containing credentials', () => {
      expect(props.url).toBe('/spotify/callback')
      expect(props.metadata.canonicalUrl).toBe('https://goosebumps.fm/spotify/callback')
      expect(() =>
        Schema.decodeUnknownSync(SpotifyCallbackApplicationProps)({ ...props, url: rawCallback }),
      ).toThrow()
      expect(
        Schema.decodeUnknownOption(SpotifyCallbackApplicationProps)({
          ...props,
          metadata: { ...props.metadata, canonicalUrl: rawCallback },
        })._tag,
      ).toBe('None')
      expect(
        Schema.decodeUnknownOption(SpotifyCallbackApplicationProps)({
          ...props,
          metadata: { ...props.metadata, title: code },
        })._tag,
      ).toBe('None')
      expect(JSON.stringify(props)).not.toContain(code)
      expect(JSON.stringify(props)).not.toContain(state)
    })

    it('server-renders connecting metadata without exchanges, status reads, query keys, or callback credentials', async () => {
      const f = pathFixture()

      const result = await runWithLayer(
        f.layer,
        HtmlServer.renderToHtml(SpotifyCallbackApplication, props),
      )

      const serialized = JSON.stringify({
        html: result.html,
        head: result.head,
        state: result.state,
      })

      expect(result.html).toContain('Connecting Spotify')
      expect(result.head).toContain('noindex,nofollow')
      expect(result.head).toContain('no-referrer')
      expect(result.state['~deferred']).toEqual([])
      expect(serialized).not.toContain(code)
      expect(serialized).not.toContain(state)
      expect(f.completions()).toBe(0)
      expect(f.statusReads()).toBe(0)
      expect(f.exchanged).toEqual([])
    })

    it('consumes the callback solely through the client service and never places credentials into native logs or queries', async () => {
      const f = pathFixture()
      await runWithLayer(
        Layer.merge(f.layer, TestHost.layer()),
        Effect.gen(function* () {
          const root = yield* TestHost.mount(SpotifyCallbackApplication, props)
          yield* TestHost.settle

          expect(f.completions()).toBe(1)
          expect(f.exchanged).toEqual([code])
          expect(f.redirected).toEqual(['/editorial/fixture?listen=1#record'])
          expect(f.values.size).toBe(0)
          expect(f.statusReads()).toBe(1)
          expect(root.fetches()).toEqual([])
          expect(root.text()).toContain('Redirecting…')

          const log = JSON.stringify(root.log())

          expect(log).not.toContain(code)
          expect(log).not.toContain(state)
          expect(log).not.toContain('?code=')
        }),
      )
    })

    it('shows the existing invalid-state error without exchanging or redirecting and consumes failed callback state', async () => {
      const f = pathFixture(false)
      await runWithLayer(
        Layer.merge(f.layer, TestHost.layer()),
        Effect.gen(function* () {
          const root = yield* TestHost.mount(SpotifyCallbackApplication, props)
          yield* TestHost.settle

          expect(root.text()).toContain('Spotify authorization is missing, expired, or invalid.')
          expect(root.all(Locator.attr('role', 'alert'))).toHaveLength(1)
          expect(f.exchanged).toEqual([])
          expect(f.redirected).toEqual([])
          expect(f.values.size).toBe(0)
          expect(JSON.stringify(root.log())).not.toContain(code)
          expect(JSON.stringify(root.log())).not.toContain(state)
        }),
      )
    })

    it('does not exchange a replayed callback after a new mount', async () => {
      const f = pathFixture()
      await runWithLayer(
        Layer.merge(f.layer, TestHost.layer()),
        Effect.gen(function* () {
          yield* TestHost.mount(SpotifyCallbackApplication, props)
          yield* TestHost.settle
          const replay = yield* TestHost.mount(SpotifyCallbackApplication, props)
          yield* TestHost.settle

          expect(f.completions()).toBe(2)
          expect(f.exchanged).toEqual([code])
          expect(replay.text()).toContain('Spotify authorization is missing, expired, or invalid.')
        }),
      )
    })

    it('starts client-only callback work without history restoration and rejects replay after scope disposal', async () => {
      const f = pathFixture()
      expect(SpotifyCallback.definition.restore).toBe(false)
      await runWithLayer(
        Layer.merge(f.layer, TestHost.layer()),
        Effect.gen(function* () {
          const root = yield* TestHost.mount(SpotifyCallbackApplication, props)
          yield* TestHost.settle
          expect(root.fetches()).toEqual([])
          expect(root.text()).toContain('Redirecting…')
          expect(f.exchanged).toEqual([code])
          expect(JSON.stringify(root.log())).not.toContain(code)
          expect(JSON.stringify(root.log())).not.toContain(state)
        }),
      )
      await runWithLayer(
        Layer.merge(f.layer, TestHost.layer()),
        Effect.gen(function* () {
          const root = yield* TestHost.mount(SpotifyCallbackApplication, props)
          yield* TestHost.settle
          expect(root.fetches()).toEqual([])
          expect(f.exchanged).toEqual([code])
          expect(root.text()).toContain('Spotify authorization is missing, expired, or invalid.')
          expect(JSON.stringify(root.log())).not.toContain(code)
          expect(JSON.stringify(root.log())).not.toContain(state)
        }),
      )
    })
  },
)
