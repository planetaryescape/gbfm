import * as Sentry from '@sentry/cloudflare'
import { Cause, Data, Exit, Match, Option, Predicate, Schema, Tracer } from 'effect'

type SdkSpan = ReturnType<typeof Sentry.startInactiveSpan>

type SpanOptions = Parameters<Tracer.Tracer['span']>[0]

const attributeValue = Schema.decodeUnknownOption(
  Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
)

const spanStatus = Data.taggedEnum<Tracer.SpanStatus>()

const measurement = Schema.decodeUnknownOption(
  Schema.Struct({
    'sentry.measurement_unit': Schema.String,
    'sentry.measurement_value': Schema.Number,
  }),
)

export const createSentryTracer = (): Tracer.Tracer =>
  Tracer.make({
    span(options) {
      const parent = Option.getOrUndefined(options.parent)
      const active = Sentry.getActiveSpan()
      const owned = parent instanceof EffectSentrySpan ? parent.sdk : undefined
      const sdkParent = parent ? owned : active

      const create = () =>
        Sentry.startInactiveSpan({
          name: options.name,
          op: Match.value(options.kind).pipe(
            Match.when('server', () => 'http.server'),
            Match.when('client', () => 'http.client'),
            Match.orElse(() => 'function'),
          ),
          startTime: Number(options.startTime) / 1_000_000_000,
          ...(options.root
            ? { parentSpan: null }
            : sdkParent
              ? { parentSpan: sdkParent }
              : undefined),
          attributes: { 'service.name': 'goosebumps-fm-api' },
        })

      const start = () => (options.sampled ? create() : Sentry.suppressTracing(create))

      const startWithParent = () => {
        if (options.root) return Sentry.startNewTrace(start)

        if (parent && !owned && (!active || active.spanContext().spanId !== parent.spanId))
          return Sentry.continueTrace(
            {
              sentryTrace: `${parent.traceId}-${parent.spanId}-${parent.sampled ? '1' : '0'}`,
              baggage: undefined,
            },
            start,
          )

        return start()
      }

      const sdk = startWithParent()

      return new EffectSentrySpan(options, sdk)
    },
    context(primitive, fiber) {
      const span = fiber.cache.span
      const sdk = span instanceof EffectSentrySpan ? span.sdk : undefined

      return sdk && Sentry.getActiveSpan() !== sdk
        ? Sentry.withActiveSpan(sdk, () => primitive['~effect/Effect/evaluate'](fiber))
        : primitive['~effect/Effect/evaluate'](fiber)
    },
  })

class EffectSentrySpan implements Tracer.Span {
  readonly _tag = 'Span' as const
  readonly attributes = new Map<string, unknown>()
  readonly links: Array<Tracer.SpanLink>
  readonly name: string
  readonly parent: Option.Option<Tracer.AnySpan>
  readonly annotations: SpanOptions['annotations']
  readonly kind: SpanOptions['kind']
  readonly spanId: string
  readonly traceId: string
  readonly sampled: boolean
  status: Tracer.SpanStatus

  constructor(
    options: SpanOptions,
    readonly sdk: SdkSpan,
  ) {
    this.name = options.name
    this.parent = options.parent
    this.annotations = options.annotations
    this.kind = options.kind
    this.links = []
    const context = sdk.spanContext()
    this.spanId = context.spanId
    this.traceId = context.traceId
    this.sampled = (context.traceFlags & 1) !== 0
    this.status = spanStatus.Started({ startTime: options.startTime })
    this.addLinks(options.links)
  }

  attribute(key: string, value: Parameters<Tracer.Span['attribute']>[1]) {
    this.attributes.set(key, value)
    const safe = attributeValue(value)

    if (Option.isSome(safe)) this.sdk.setAttribute(key, safe.value)
  }

  event(name: string, time: bigint, attributes?: Parameters<Tracer.Span['event']>[2]) {
    if (!attributes || !('sentry.measurement_value' in attributes)) return
    const decoded = measurement(attributes)

    if (Option.isNone(decoded)) return

    this.sdk.addEvent(name, decoded.value, Number(time) / 1_000_000_000)
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>) {
    this.links.push(...links)

    for (const link of links)
      this.sdk.addLink({
        context: {
          traceId: link.span.traceId,
          spanId: link.span.spanId,
          traceFlags: link.span.sampled ? 1 : 0,
        },
      })
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
    if (Predicate.isTagged(this.status, 'Ended')) return
    this.status = spanStatus.Ended({ startTime: this.status.startTime, endTime, exit })
    const failed = Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
    this.sdk.setStatus({ code: failed ? 2 : 1 })
    this.sdk.end(Number(endTime) / 1_000_000_000)
  }
}
