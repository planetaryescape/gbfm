import { Effect, Deferred, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import { disconnected, SpotifyConnection, SpotifyConnectionError } from './connection'
import { initialModel, Load, Message, Model, update } from './playback'

const Operation = Model.fields.operation

const track = 'https://open.spotify.com/track/FixtureTrack'

const service = (
  overrides: Partial<SpotifyConnection['Service']> = {},
): SpotifyConnection['Service'] => ({
  status: Effect.succeed({ connected: true, name: 'Fixture' }),
  playback: () => Effect.succeed('fixture completed'),
  connect: Effect.void,
  disconnect: Effect.succeed(disconnected),
  completeCallback: Effect.void,
  ...overrides,
})

describe('Spotify playback ownership', () => {
  it('releases connect ownership on error without changing loaded status', async () => {
    const status = { connected: false, name: '' }
    const model = update(initialModel, Message.Loaded({ status })).model
    const request = update(model, Message.Requested({ action: 'connect', url: track }))
    const command = request.commands?.[0]
    expect(command).toBeDefined()

    if (!command) return

    const completion = await Effect.runPromise(
      command.effect.pipe(
        Effect.provideService(
          SpotifyConnection,
          service({
            connect: Effect.fail(new SpotifyConnectionError({ message: 'fixture login failed' })),
          }),
        ),
      ),
    )

    const completed = update(request.model, completion).model
    expect(completed.status).toEqual(status)
    expect(completed.operation).toEqual(
      Operation.cases.Idle.make({ target: track, notice: 'fixture login failed' }),
    )
    expect(
      update(completed, Message.Requested({ action: 'connect', url: track })).commands,
    ).toHaveLength(1)
  })
  it('loads status and preserves the disconnected fallback on failure', async () => {
    const loaded = await Effect.runPromise(
      Load().effect.pipe(Effect.provideService(SpotifyConnection, service())),
    )

    expect(update(initialModel, loaded).model.status).toEqual({ connected: true, name: 'Fixture' })

    const failed = await Effect.runPromise(
      Load().effect.pipe(
        Effect.provideService(
          SpotifyConnection,
          service({
            status: Effect.fail(new SpotifyConnectionError({ message: 'fixture offline' })),
          }),
        ),
      ),
    )

    expect(update(initialModel, failed).model.status).toEqual(disconnected)
  })

  it.each(['play', 'queue', 'connect'] as const)(
    'serializes repeated %s actions and retains the target after completion',
    async (action) => {
      const calls: Array<string> = []
      const request = update(initialModel, Message.Requested({ action, url: track }))
      expect(request.model.operation).toEqual(Operation.cases.Running.make({ action, url: track }))

      const repeated = update(
        request.model,
        Message.Requested({ action: 'queue', url: 'different' }),
      )

      expect(repeated.model).toBe(request.model)
      expect(repeated.commands).toBeUndefined()
      const command = request.commands?.[0]
      expect(command).toBeDefined()

      if (!command) return

      const completion = await Effect.runPromise(
        command.effect.pipe(
          Effect.provideService(
            SpotifyConnection,
            service({
              connect: Effect.sync(() => {
                calls.push('connect')
              }),
              playback: ({ action, url }) =>
                Effect.sync(() => {
                  calls.push(`${action}:${url}`)

                  return 'fixture completed'
                }),
            }),
          ),
        ),
      )

      const completed = update(request.model, completion).model
      expect(completed.operation).toEqual(
        Operation.cases.Idle.make({
          target: track,
          notice: action === 'connect' ? '' : 'fixture completed',
        }),
      )
      expect(calls).toEqual([action === 'connect' ? 'connect' : `${action}:${track}`])
      expect(update(completed, Message.Requested({ action, url: track })).commands).toHaveLength(1)
    },
  )

  it('retains partial failure notices and allows another operation', async () => {
    const request = update(initialModel, Message.Requested({ action: 'queue', url: track }))
    const command = request.commands?.[0]
    expect(command).toBeDefined()

    if (!command) return
    const notice = 'Queue actions may have partially completed.'

    const completion = await Effect.runPromise(
      command.effect.pipe(
        Effect.provideService(
          SpotifyConnection,
          service({
            playback: () => Effect.fail(new SpotifyConnectionError({ message: notice })),
          }),
        ),
      ),
    )

    const completed = update(request.model, completion).model
    expect(completed.operation).toEqual(Operation.cases.Idle.make({ target: track, notice }))
    expect(
      update(completed, Message.Requested({ action: 'play', url: track })).commands,
    ).toHaveLength(1)
  })

  it('does not cancel pending work when disconnected status arrives', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<string>()
        const request = update(initialModel, Message.Requested({ action: 'play', url: track }))
        const command = request.commands?.[0]
        expect(command).toBeDefined()

        if (!command) return

        const fiber = yield* command.effect.pipe(
          Effect.provideService(
            SpotifyConnection,
            service({ playback: () => Deferred.await(gate) }),
          ),
          Effect.forkChild,
        )

        const disconnectedModel = update(
          request.model,
          Message.Loaded({ status: disconnected }),
        ).model

        expect(disconnectedModel.operation).toEqual(request.model.operation)
        yield* Deferred.succeed(gate, 'late completion')
        const completion = yield* Fiber.join(fiber)
        const completed = update(disconnectedModel, completion).model
        expect(completed.status).toEqual(disconnected)
        expect(completed.operation).toEqual(
          Operation.cases.Idle.make({
            target: track,
            notice: 'late completion',
          }),
        )
      }),
    )
  })

  it('preserves uncorrelated stale status and completion delivery', () => {
    const first = update(initialModel, Message.Requested({ action: 'queue', url: track })).model
    const completed = update(first, Message.Completed({ notice: 'first' })).model
    const second = update(completed, Message.Requested({ action: 'play', url: 'second' })).model
    const stale = update(second, Message.Completed({ notice: 'late first' })).model
    expect(stale.operation).toEqual(
      Operation.cases.Idle.make({ target: 'second', notice: 'late first' }),
    )
    const disconnectedModel = update(stale, Message.Loaded({ status: disconnected })).model
    expect(
      update(
        disconnectedModel,
        Message.Loaded({ status: { connected: true, name: 'stale status' } }),
      ).model.status?.connected,
    ).toBe(true)
    expect(
      update(initialModel, Message.Completed({ notice: 'unsolicited' })).model.operation,
    ).toEqual(Operation.cases.Idle.make({ target: null, notice: 'unsolicited' }))
  })
})
