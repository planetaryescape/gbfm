import { OtelTracer, Resource } from '@effect/opentelemetry'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { Cause, Effect, Exit, Layer, Result } from 'effect'
import { describe, expect, test } from 'vitest'

import { MusicProviderRequestFailed } from '@/errors'
import { withTestLayer } from '@/test/effect'

import { MusicIdentityProviderUnavailable } from './errors'
import { parseMusicSource } from './music-source'
import {
  annotateEntity,
  annotateSource,
  getSafeErrorTag,
  withSafeSpan,
  withSafeTypedSpan,
} from './telemetry'

const serializedTelemetry = <A>(value: A) => JSON.stringify(value)

const serializedSpanData = (span: ReturnType<InMemorySpanExporter['getFinishedSpans']>[number]) =>
  serializedTelemetry({
    name: span.name,
    attributes: span.attributes,
    events: span.events,
    status: span.status,
    links: span.links,
    resource: span.resource.attributes,
    instrumentationScope: span.instrumentationScope,
  })

const expectNoForbiddenTelemetry = (serialized: string, forbidden: ReadonlyArray<string>) => {
  for (const value of forbidden) expect(serialized).not.toContain(value)
}

describe('canonical music identity telemetry', () => {
  test('extracts only schema-validated error tags', () => {
    const privateMessage = 'Provider response included token=private'
    expect(
      getSafeErrorTag(
        new MusicIdentityProviderUnavailable({
          provider: 'spotify',
          message: privateMessage,
        }),
      ),
    ).toBe('MusicIdentityProviderUnavailable')
    expect(getSafeErrorTag({ _tag: privateMessage })).toBeUndefined()
  })

  test('exports only safe failure data while restoring failures, defects, and interruption', async () => {
    const exporter = new InMemorySpanExporter()

    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })

    provider.register()

    const tracingLive = OtelTracer.layerGlobal.pipe(
      Layer.provide(Resource.layer({ serviceName: 'music-identity-telemetry-test' })),
    )

    const rawUrl = 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh?si=private'
    const rawSourceKey = 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh'
    const rawToken = 'token=provider-secret'
    const providerMessage = `Provider unavailable at ${rawUrl} with ${rawToken}`

    try {
      const checked = Effect.gen(function* () {
        const source = yield* parseMusicSource(rawUrl, 'track')
        yield* annotateSource(source)
        yield* annotateEntity({ entityType: 'track', entityId: 'entity-1' })
        yield* Effect.annotateCurrentSpan({ result: 'reclaimed', retryCount: 2, claimAgeMs: 50 })

        return yield* new MusicIdentityProviderUnavailable({
          provider: 'spotify',
          statusCode: 503,
          message: providerMessage,
        })
      }).pipe(withSafeTypedSpan('musicIdentity.claim'))

      const providerFailure = Effect.fail(
        new MusicProviderRequestFailed({
          message: providerMessage,
          operation: 'getTrackForImport',
          statusCode: 503,
        }),
      ).pipe(withSafeSpan('musicIdentity.scrape'))

      const defect = Effect.die(new Error(providerMessage)).pipe(
        withSafeSpan('musicIdentity.commit'),
      )

      const interruption = Effect.interrupt.pipe(withSafeSpan('musicIdentity.interrupted'))

      const checkedExit = await Effect.runPromiseExit(withTestLayer(checked, tracingLive))
      const providerExit = await Effect.runPromiseExit(withTestLayer(providerFailure, tracingLive))
      const defectExit = await Effect.runPromiseExit(withTestLayer(defect, tracingLive))
      const interruptionExit = await Effect.runPromiseExit(withTestLayer(interruption, tracingLive))
      await provider.forceFlush()

      const checkedError = Result.getOrThrow(Exit.findError(checkedExit))
      expect(checkedError._tag).toBe('MusicIdentityProviderUnavailable')
      expect(checkedError).toMatchObject({
        message: providerMessage,
      })
      const providerError = Result.getOrThrow(Exit.findError(providerExit))
      expect(providerError._tag).toBe('MusicProviderRequestFailed')
      expect(providerError).toMatchObject({
        message: providerMessage,
      })
      expect(Exit.isFailure(defectExit) && defectExit.cause.reasons.some(Cause.isDieReason)).toBe(
        true,
      )
      expect(
        Exit.isFailure(interruptionExit) && Cause.hasInterruptsOnly(interruptionExit.cause),
      ).toBe(true)

      const spans = exporter.getFinishedSpans()
      const checkedSpan = spans.find((span) => span.name === 'musicIdentity.claim')
      expect(checkedSpan?.attributes).toMatchObject({
        platform: 'spotify',
        sourceEntityType: 'track',
        entityType: 'track',
        entityId: 'entity-1',
        result: 'reclaimed',
        retryCount: 2,
        claimAgeMs: 50,
        errorTag: 'MusicIdentityProviderUnavailable',
        outcome: 'failure',
      })
      expect(checkedSpan?.attributes.sourceKeyHash).toMatch(/^[a-f0-9]{64}$/)
      expect(spans.find((span) => span.name === 'musicIdentity.scrape')?.attributes).toMatchObject({
        errorTag: 'MusicProviderRequestFailed',
        outcome: 'failure',
      })

      for (const span of spans) {
        expect([{ code: SpanStatusCode.UNSET }, { code: SpanStatusCode.OK }]).toContainEqual(
          span.status,
        )
        expect(span.events).toEqual([])
        expectNoForbiddenTelemetry(serializedSpanData(span), [
          rawUrl,
          rawSourceKey,
          rawToken,
          providerMessage,
        ])
        expectNoForbiddenTelemetry(serializedTelemetry(span.attributes), [
          rawUrl,
          rawSourceKey,
          rawToken,
          providerMessage,
        ])
        expectNoForbiddenTelemetry(serializedTelemetry(span.events), [
          rawUrl,
          rawSourceKey,
          rawToken,
          providerMessage,
        ])
        expectNoForbiddenTelemetry(serializedTelemetry(span.status), [
          rawUrl,
          rawSourceKey,
          rawToken,
          providerMessage,
        ])
      }
    } finally {
      await provider.shutdown()
      trace.disable()
    }
  })
})
