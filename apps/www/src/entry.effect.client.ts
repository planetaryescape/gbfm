import { HtmlHydrate } from '@effect/ui/html'
import { Effect, Fiber, Layer } from 'effect'

import './styles/main.css'
import { Application } from './app/application'
import { readHydration } from './app/hydration'
import { startTheme } from './theme'

const container = document.getElementById('root')

if (!container) throw new Error('Missing application root')

const { props, state } = readHydration(document)

const application = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.sync(startTheme), (stop) => Effect.sync(stop))
    const root = yield* HtmlHydrate.hydrateEffect(Application, props, container, state)
    yield* root.adopted
    document.documentElement.dataset.gbfmHydrated = 'true'
  }),
)

const fiber = Effect.runFork(Layer.launch(application))

const dispose = () => {
  window.removeEventListener('pagehide', onPageHide)
  Effect.runFork(Fiber.interrupt(fiber))
}

const onPageHide = (event: PageTransitionEvent) => {
  if (!event.persisted) dispose()
}

window.addEventListener('pagehide', onPageHide)

import.meta.hot?.dispose(dispose)
