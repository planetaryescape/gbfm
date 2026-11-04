import { Deferred, Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import { disconnected, SpotifyConnection, SpotifyConnectionError } from '../../spotify/connection'
import { SpotifyRequest } from './command'
import { initialModel } from './init'
import { Message } from './message'
import { update } from './update'

const member = { id: 'member', role: 'user' as const }

describe('dashboard Spotify ownership', () => {
  it('blocks duplicate commands but permits disconnect to supersede pending work', () => {
    const model = initialModel('integrations', member)
    const pending = update(model, Message.SpotifyRequested({ action: 'connect' })).model

    for (const action of ['connect', 'status', 'completeCallback'] as const) {
      const result = update(pending, Message.SpotifyRequested({ action }))
      expect(result.model).toBe(pending)
      expect(result.commands).toBeUndefined()
    }

    const result = update(pending, Message.SpotifyRequested({ action: 'disconnect' }))
    expect(result.commands?.[0]).toMatchObject({
      name: 'Spotify.Connection',
      args: { action: 'disconnect', requestId: 2 },
    })
  })

  it('rejects a stale status result after a later disconnect', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Deferred.make<typeof disconnected>()
        const started = yield* Deferred.make<void>()

        const service = SpotifyConnection.of({
          status: Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(result))),
          connect: Effect.void,
          completeCallback: Effect.void,
          disconnect: Effect.succeed(disconnected),
          playback: () => Effect.succeed('unused'),
        })

        const pending = update(
          initialModel('integrations', member),
          Message.SpotifyRequested({ action: 'status' }),
        ).model

        const old = yield* SpotifyRequest({ action: 'status', requestId: 1 }).effect.pipe(
          Effect.provideService(SpotifyConnection, service),
          Effect.forkChild,
        )

        yield* Deferred.await(started)
        const disconnect = update(pending, Message.SpotifyRequested({ action: 'disconnect' })).model

        const completed = update(
          disconnect,
          yield* SpotifyRequest({ action: 'disconnect', requestId: 2 }).effect.pipe(
            Effect.provideService(SpotifyConnection, service),
          ),
        ).model

        yield* Deferred.succeed(result, { connected: true, name: 'Stale account' })
        const stale = update(completed, yield* Fiber.join(old)).model
        expect(stale).toBe(completed)
        expect(stale.spotify).toEqual(disconnected)
      }).pipe(Effect.scoped),
    )
  })

  it('reads status after callback/connect and correlates failures', async () => {
    const service = SpotifyConnection.of({
      status: Effect.succeed(disconnected),
      connect: Effect.void,
      completeCallback: Effect.void,
      disconnect: Effect.fail(new SpotifyConnectionError({ message: 'Disconnect failed' })),
      playback: () => Effect.succeed('unused'),
    })

    for (const action of ['connect', 'completeCallback'] as const) {
      const result = await Effect.runPromise(
        SpotifyRequest({ action, requestId: 1 }).effect.pipe(
          Effect.provideService(SpotifyConnection, service),
        ),
      )

      expect(result).toEqual(Message.SpotifyLoaded({ requestId: 1, status: disconnected }))
    }

    const failed = await Effect.runPromise(
      SpotifyRequest({ action: 'disconnect', requestId: 1 }).effect.pipe(
        Effect.provideService(SpotifyConnection, service),
      ),
    )

    const pending = update(
      initialModel('integrations', member),
      Message.SpotifyRequested({ action: 'disconnect' }),
    ).model

    const model = update(pending, failed).model
    expect(model).toMatchObject({ phase: 'error', error: 'Disconnect failed' })
  })
})
