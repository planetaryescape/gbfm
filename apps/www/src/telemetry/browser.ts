import { Data } from 'effect'
import { onCLS, onINP, onLCP, type Metric } from 'web-vitals'

import {
  MAX_BATCH_EVENTS,
  TELEMETRY_VERSION,
  type BrowserTelemetryBatch,
  type BrowserTelemetryEvent,
} from './contract'
import { boundedName, errorFingerprint, routeTemplate } from './privacy'
import { anonymousSession } from './session'

/** Production browser sampling probability. */
export const TELEMETRY_SAMPLE_RATE = 0.1

const FLUSH_DELAY_MS = 5_000

const PLAYER_EVENT = 'gbfm:player-telemetry'

/** The bounded player actions accepted by browser telemetry. */
export type PlayerTelemetryName = 'play' | 'pause' | 'stall' | 'error'

/** A framework router location. The route ID must be a low-cardinality template. */
export type TelemetryRoute = {
  readonly routeId?: string | null
  readonly pathname: string
}

/** Router adapter used to measure navigation from its true start and completion boundaries. */
export type TelemetryNavigation = {
  readonly current: () => TelemetryRoute
  readonly subscribe: (hooks: {
    readonly before: () => void
    readonly after: (route: TelemetryRoute) => void
  }) => () => void
}

type Transport = {
  readonly beacon: (body: string) => boolean
  readonly fetch: (body: string) => Promise<void>
}

type BatchQueue =
  | { readonly _tag: 'Empty' }
  | { readonly _tag: 'Scheduled'; readonly events: Array<BrowserTelemetryEvent> }

const BatchQueue = Data.taggedEnum<BatchQueue>()

/** A browser telemetry queue with explicit lifecycle flush control. */
export type TelemetryBatcher = {
  readonly add: (event: BrowserTelemetryEvent) => void
  readonly flush: () => void
}

/** Returns a stable deterministic sampling decision for an anonymous session. */
export function isSampled(session: string, rate: number = TELEMETRY_SAMPLE_RATE): boolean {
  let hash = 0

  for (const character of session) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0

  return hash / 0x1_0000_0000 < rate
}

/** Creates a bounded batch queue that prefers beacon and falls back to keepalive fetch. */
export function createTelemetryBatcher(input: {
  readonly session: string
  readonly release: string
  readonly sampleRate?: number
  readonly transport: Transport
  readonly now?: () => number
  readonly schedule?: (flush: () => void, delay: number) => void
}): TelemetryBatcher {
  let state: BatchQueue = BatchQueue.Empty()
  const now = input.now ?? Date.now
  const schedule = input.schedule ?? ((flush, delay) => globalThis.setTimeout(flush, delay))

  const flush = () => {
    const events = BatchQueue.$match(state, {
      Empty: () => [],
      Scheduled: ({ events }) => events,
    })

    state = BatchQueue.Empty()

    if (events.length === 0) return

    const batch: BrowserTelemetryBatch = {
      version: TELEMETRY_VERSION,
      session: input.session,
      release: input.release,
      sampleRate: input.sampleRate ?? TELEMETRY_SAMPLE_RATE,
      sentAt: now(),
      events,
    }

    const body = JSON.stringify(batch)

    if (!input.transport.beacon(body)) void input.transport.fetch(body).catch(() => undefined)
  }

  return {
    add(event) {
      if (BatchQueue.$is('Scheduled')(state)) {
        state.events.push(event)

        if (state.events.length >= MAX_BATCH_EVENTS) flush()
      } else {
        const batch = BatchQueue.Scheduled({ events: [event] })
        state = batch
        schedule(() => {
          if (state === batch) flush()
        }, FLUSH_DELAY_MS)
      }
    },
    flush,
  }
}

/** Emits a privacy-bounded player action for the active browser collector. */
export function reportPlayerTelemetry(name: PlayerTelemetryName): void {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(PLAYER_EVENT, { detail: name }))
}

/** Starts browser telemetry and returns an idempotent lifecycle disposer. */
export function startBrowserTelemetry(input: {
  readonly release: string
  readonly navigation: TelemetryNavigation
  readonly endpoint?: string
  readonly sampleRate?: number
  readonly observeVitals?: (report: (metric: Metric) => void) => void
}): () => void {
  const release = boundedName(input.release, 'unknown')
  const sampleRate = input.sampleRate ?? (release === 'local' ? 1 : TELEMETRY_SAMPLE_RATE)
  const session = anonymousSession(localStorage, Date.now())

  if (!isSampled(session, sampleRate)) return () => undefined

  const endpoint = input.endpoint ?? '/telemetry/browser'

  const batcher = createTelemetryBatcher({
    session,
    release,
    sampleRate,
    transport: {
      beacon: (body) =>
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' })),
      fetch: (body) =>
        fetch(endpoint, {
          method: 'POST',
          body,
          keepalive: true,
          headers: { 'content-type': 'application/json' },
        }).then(() => undefined),
    },
  })

  let currentRoute = routeTemplate(
    input.navigation.current().routeId,
    input.navigation.current().pathname,
  )

  const vitalRoute = currentRoute
  let disposed = false
  let navigationStartedAt: number | undefined
  batcher.add({
    kind: 'navigation',
    name: 'initial-load',
    route: currentRoute,
    value: Math.round(performance.now()),
  })

  const stopNavigation = input.navigation.subscribe({
    before: () => {
      if (disposed) return
      navigationStartedAt = performance.now()
    },
    after: (route) => {
      if (disposed) return
      currentRoute = routeTemplate(route.routeId, route.pathname)
      const startedAt = navigationStartedAt
      navigationStartedAt = undefined
      batcher.add({
        kind: 'navigation',
        name: 'spa-navigation',
        route: currentRoute,
        value: Math.round(startedAt === undefined ? 0 : performance.now() - startedAt),
      })
    },
  })

  const reportVital = (metric: Metric) => {
    if (disposed) return
    let name: 'cls' | 'inp' | 'lcp'

    switch (metric.name) {
      case 'CLS':
        name = 'cls'
        break
      case 'INP':
        name = 'inp'
        break
      case 'LCP':
        name = 'lcp'
        break
    }

    batcher.add({
      kind: 'web-vital',
      name,
      route: vitalRoute,
      value:
        metric.name === 'CLS' ? Math.round(metric.value * 1_000) / 1_000 : Math.round(metric.value),
    })
  }

  if (input.observeVitals) input.observeVitals(reportVital)
  else {
    onCLS(reportVital)
    onINP(reportVital)
    onLCP(reportVital)
  }

  const reportError = (event: ErrorEvent) =>
    batcher.add({
      kind: 'ui-error',
      name: errorFingerprint(event.error instanceof Error ? event.error : event.message, 'error'),
      route: currentRoute,
    })

  const reportRejection = (event: PromiseRejectionEvent) =>
    batcher.add({
      kind: 'ui-error',
      name: errorFingerprint(
        event.reason instanceof Error ? event.reason : 'unknown-rejection',
        'rejection',
      ),
      route: currentRoute,
    })

  const reportPlayer = (event: Event) => {
    if (!(event instanceof CustomEvent)) return
    const name: unknown = event.detail

    if (name === 'play' || name === 'pause' || name === 'stall' || name === 'error')
      batcher.add({ kind: 'player', name, route: currentRoute })
  }

  const flushWhenHidden = () => {
    if (document.visibilityState === 'hidden') batcher.flush()
  }

  window.addEventListener('error', reportError)
  window.addEventListener('unhandledrejection', reportRejection)
  window.addEventListener(PLAYER_EVENT, reportPlayer)
  window.addEventListener('pagehide', batcher.flush)
  document.addEventListener('visibilitychange', flushWhenHidden)

  return () => {
    if (disposed) return
    disposed = true
    batcher.flush()
    stopNavigation()
    window.removeEventListener('error', reportError)
    window.removeEventListener('unhandledrejection', reportRejection)
    window.removeEventListener(PLAYER_EVENT, reportPlayer)
    window.removeEventListener('pagehide', batcher.flush)
    document.removeEventListener('visibilitychange', flushWhenHidden)
  }
}
