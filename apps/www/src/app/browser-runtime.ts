import { Effect, Layer } from 'effect'

import { webObservabilityLayer } from '../observability/sentry'
import {
  startBrowserTelemetry,
  type TelemetryNavigation,
  type TelemetryRoute,
} from '../telemetry/browser'
import { startTheme } from '../theme'
import { startArtworkFallback } from '../ui/artwork'
import { navigationEnd, navigationStart } from './navigation-events'

export { navigationCompleted, navigationStarted } from './navigation-events'

export type BrowserSupportOptions = {
  readonly release: string
  readonly currentRoute?: () => TelemetryRoute
}

const browserNavigation = (current: () => TelemetryRoute): TelemetryNavigation => ({
  current,
  subscribe: ({ before, after }) => {
    const completed = () => after(current())
    window.addEventListener(navigationStart, before)
    window.addEventListener(navigationEnd, completed)

    return () => {
      window.removeEventListener(navigationStart, before)
      window.removeEventListener(navigationEnd, completed)
    }
  },
})

export const makeBrowserSupportLayer = (options: BrowserSupportOptions) => {
  const lifecycle = Layer.effectDiscard(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(Effect.sync(startTheme), (stop) => Effect.sync(stop))
      yield* Effect.acquireRelease(Effect.sync(startArtworkFallback), (stop) => Effect.sync(stop))
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          startBrowserTelemetry({
            release: options.release,
            navigation: browserNavigation(
              options.currentRoute ?? (() => ({ pathname: window.location.pathname })),
            ),
          }),
        ),
        (stop) => Effect.sync(stop),
      )
    }),
  )

  return Layer.merge(webObservabilityLayer, lifecycle)
}
