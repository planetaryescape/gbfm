import { Cause, Clock, Context, Effect, Exit, Layer, Schema } from 'effect'

export const JourneyName = Schema.Literals(['reader.open', 'playback.start', 'navigation'])

export type JourneyName = typeof JourneyName.Type

export const JourneyOutcome = Schema.Literals(['succeeded', 'failed', 'canceled', 'empty'])

export type JourneyOutcome = typeof JourneyOutcome.Type

export class ExportUnavailable extends Schema.TaggedError<ExportUnavailable>()(
  'Observability.ExportUnavailable',
  {},
) {}

export type Journey = {
  readonly finish: (outcome: JourneyOutcome) => Effect.Effect<void>
}

export class JourneyExporter extends Context.Service<
  JourneyExporter,
  {
    readonly open: (name: JourneyName) => Effect.Effect<
      {
        readonly finish: (
          outcome: JourneyOutcome,
          durationMs: number,
        ) => Effect.Effect<void, ExportUnavailable>
      },
      ExportUnavailable
    >
  }
>()('@gbfm/observability/JourneyExporter') {}

export class Observability extends Context.Service<
  Observability,
  {
    readonly start: (name: JourneyName) => Effect.Effect<Journey>
  }
>()('@gbfm/observability/Observability') {}

const inactive: Journey = { finish: () => Effect.void }

export const observabilityLayer = Layer.effect(
  Observability,
  Effect.gen(function* () {
    const exporter = yield* JourneyExporter
    const clock = yield* Clock.Clock
    const pending = new Set<Journey>()
    let closed = false

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        closed = true
        yield* Effect.forEach([...pending], (journey) => journey.finish('canceled'), {
          discard: true,
        })
      }),
    )

    const start = Effect.fn('Observability.start')(function* (name: JourneyName) {
      if (closed || pending.size >= 30) return inactive

      const startedAt = yield* clock.monotonicTimeNanos

      const exported = yield* exporter
        .open(name)
        .pipe(Effect.catchTag('Observability.ExportUnavailable', () => Effect.succeed(undefined)))

      if (!exported) return inactive

      let finished = false

      const journey: Journey = {
        finish: Effect.fn('Observability.finish')(function* (outcome: JourneyOutcome) {
          if (finished) return
          finished = true
          pending.delete(journey)
          const endedAt = yield* clock.monotonicTimeNanos
          const durationMs = Math.max(0, Number(endedAt - startedAt) / 1_000_000)
          yield* exported
            .finish(outcome, durationMs)
            .pipe(Effect.catchTag('Observability.ExportUnavailable', () => Effect.void))
        }),
      }

      pending.add(journey)

      return journey
    })

    return Observability.of({ start })
  }),
)

export const disabledObservabilityLayer = Layer.succeed(Observability, {
  start: () => Effect.succeed(inactive),
})

export const observeJourney = Effect.fnUntraced(function* <A, E, R>(
  name: JourneyName,
  work: Effect.Effect<A, E, R>,
) {
  const service = yield* Observability

  return yield* Effect.acquireUseRelease(
    service.start(name),
    () => work,
    (journey, exit) => {
      if (Exit.isSuccess(exit)) return journey.finish('succeeded')

      return journey.finish(Cause.hasInterruptsOnly(exit.cause) ? 'canceled' : 'failed')
    },
  )
})
