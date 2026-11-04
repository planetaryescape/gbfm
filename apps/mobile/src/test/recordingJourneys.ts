import {
  JourneyExporter,
  Observability,
  observabilityLayer,
  type JourneyName,
  type JourneyOutcome,
} from '@gbfm/observability'
import { journeyObserver } from '@gbfm/observability/callbacks'
import { Clock, Effect, Layer, ManagedRuntime } from 'effect'

export const recordingJourneys = () => {
  const records: Array<{ name: JourneyName; outcome: JourneyOutcome; durationMs: number }> = []
  const starts: Array<JourneyName> = []
  let time = 0

  const exporter = Layer.succeed(JourneyExporter, {
    open: (name) =>
      Effect.sync(() => {
        starts.push(name)

        return {
          finish: (outcome, durationMs) =>
            Effect.sync(() => {
              records.push({ name, outcome, durationMs })
            }),
        }
      }),
  })

  const clock = Effect.runSync(Clock.Clock)
  const nanos = () => BigInt(time) * 1_000_000n

  const runtime = ManagedRuntime.make(
    observabilityLayer.pipe(
      Layer.provide([
        exporter,
        Layer.succeed(Clock.Clock, {
          currentTimeMillis: clock.currentTimeMillis,
          currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
          currentTimeNanos: clock.currentTimeNanos,
          currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
          sleep: (duration) => clock.sleep(duration),
          monotonicTimeNanos: Effect.sync(nanos),
          monotonicTimeNanosUnsafe: nanos,
        }),
      ]),
    ),
  )

  return {
    observer: journeyObserver(runtime.runSync(Observability)),
    dispose: () => runtime.dispose(),
    records,
    starts,
    advance: (ms: number) => {
      time += ms
    },
  }
}
