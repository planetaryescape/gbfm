import { MessageLog } from '@effect/ui'
import { BrowserHost } from '@effect/ui/html'
import { Effect, Fiber, Layer, Option, Predicate, Schema } from 'effect'

import { playerCommandsLayer } from '../../src/features/player/provider'
import { PlayerClient } from '../../src/player/runtime'
import { HomeTouchApp } from './App'
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This fixture composition root acquires and disposes the injected audio runtime.
import { makeHomeTouchRuntime, type ScalarRecord } from './runtime'

const container = document.getElementById('app')

const output = document.getElementById('evidence')

const state = document.getElementById('platform')

const controls = document.getElementById('controls')

if (!container || !output || !state || !controls) throw new Error('Missing player fixture roots')

const entries: Array<ScalarRecord> = []

let modelTime: number | null = null

const record = (entry: ScalarRecord) => {
  entries.push({ order: entries.length, at: performance.now(), ...entry })
  output.textContent = JSON.stringify(entries)
}

const platform = await makeHomeTouchRuntime((entry: ScalarRecord) => record(entry))

const Transport = Schema.Struct({ transport: Schema.Struct({ currentTime: Schema.Number }) })

const Model = Schema.Struct({ snapshot: Transport })

const Message = Schema.Struct({
  _tag: Schema.Literals([
    'RequestedSeek',
    'CompletedSeek',
    'ChangedSnapshot',
    'PreviewedSeek',
    'CommittedSeek',
    'CancelledSeek',
  ]),
  seconds: Schema.optional(Schema.Number),
  referenceSeconds: Schema.optional(Schema.Number),
  pointerRatio: Schema.optional(Schema.Number),
  fine: Schema.optional(Schema.Boolean),
  snapshot: Schema.optional(Transport),
})

const logger = {
  enabled: true,
  record: (entry: MessageLog.Entry) => {
    if (Predicate.isTagged(entry, 'MountStarted') && entry.name === 'TrackScrubberGesture')
      record({ kind: 'scrubber-mounted' })

    if (!Predicate.isTagged(entry, 'Update') || !entry.path.includes('/PlayerProvider')) return
    const model = Schema.decodeUnknownOption(Model)(entry.model)
    const message = Schema.decodeUnknownOption(Message)(entry.message)

    if (Option.isNone(model) || Option.isNone(message)) return
    modelTime = model.value.snapshot.transport.currentTime
    record({
      kind: message.value._tag,
      seq: entry.seq,
      time: entry.at,
      modelTime,
      seconds: message.value.seconds,
      referenceSeconds: message.value.referenceSeconds,
      pointerRatio: message.value.pointerRatio,
      fine: message.value.fine,
      incomingPosition: message.value.snapshot?.transport.currentTime,
    })
  },
}

const root = Effect.runFork(
  BrowserHost.mount(HomeTouchApp, {}, container).pipe(
    Layer.provide(
      playerCommandsLayer.pipe(
        Layer.provide(Layer.succeed(PlayerClient, { controller: platform.controller })),
      ),
    ),
    Layer.provide(Layer.succeed(MessageLog.MessageLog, logger)),
    Layer.launch,
  ),
)

for (const [label, run] of [
  ['Start fixture', platform.start],
  ['Pause fixture', platform.pause],
  ['Seed position', platform.seed],
  ['Arm Home gate', platform.arm],
  ['Emit current status', platform.emitCurrent],
  ['Release Home', platform.release],
] satisfies ReadonlyArray<readonly [string, () => Promise<void>]>) {
  const button = document.createElement('button')
  button.textContent = label
  button.addEventListener('click', async () => {
    button.dataset.status = 'pending'

    try {
      await run()
      button.dataset.status = 'complete'
    } catch {
      button.dataset.status = 'failed'
    }
  })
  controls.append(button)
}

const dispose = document.createElement('button')

dispose.textContent = 'Dispose fixture'

dispose.addEventListener('click', async () => {
  await Effect.runPromise(Fiber.interrupt(root))
  await platform.dispose()
  container.dataset.disposed = 'true'
})

controls.append(dispose)

for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'input', 'keydown'])
  container.addEventListener(
    type,
    (event) => {
      const input = container.querySelector('.hill-scrubber-input')
      const hill = container.querySelector('.hill-scrubber')

      if (!(input instanceof HTMLInputElement) || !hill) return
      const bounds = hill.getBoundingClientRect()
      record({
        kind: type,
        hillTarget:
          event.target instanceof Element && event.target.closest('.hill-scrubber') !== null,
        inputValue: Number(input.value),
        modelTime,
        audioTime: platform.inspect().audioTime,
        x: event instanceof PointerEvent ? event.clientX : null,
        left: bounds.left,
        width: bounds.width,
      })
    },
    true,
  )

const tick = () => {
  if (container.dataset.disposed === 'true') return
  state.textContent = JSON.stringify(platform.inspect())
  requestAnimationFrame(tick)
}

requestAnimationFrame(tick)
