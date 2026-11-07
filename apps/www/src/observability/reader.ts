import { Observability } from '@gbfm/observability'
import { journeyObserver, type JourneyObserver } from '@gbfm/observability/callbacks'
import { readerJourney } from '@gbfm/observability/reader'
import { Effect, Layer, Option, Schema } from 'effect'

const committedState = Schema.decodeUnknownOption(
  Schema.Struct({
    active: Schema.Literals(['true', 'false']),
    request: Schema.NumberFromString,
    status: Schema.Literals(['loading', 'ready', 'empty', 'error']),
  }),
)

export const observeReader = (root: Element, observer: JourneyObserver) => {
  const visits = readerJourney(observer)
  const document = root.ownerDocument
  const window = document.defaultView
  let request: number | undefined
  let cancel = () => {}

  let suspended = false

  const pause = () => {
    cancel()
    request = undefined
  }

  const scan = () => {
    if (suspended || document.visibilityState === 'hidden') {
      pause()

      return
    }

    const element = root.matches('[data-reader-active]')
      ? root
      : root.querySelector('[data-reader-active]')

    const decoded = committedState({
      active: element?.getAttribute('data-reader-active'),
      request: element?.getAttribute('data-reader-request'),
      status: element?.getAttribute('data-reader-status'),
    })

    if (Option.isNone(decoded)) {
      pause()

      return
    }

    const state = decoded.value

    if (state.active === 'false') {
      if (state.status === 'error' && request !== undefined)
        visits.committed({ request, status: 'error', hasContent: false })
      pause()

      return
    }

    if (request !== state.request) {
      cancel()
      request = state.request
      cancel = visits.start(request)
    }

    visits.committed({
      request: state.request,
      status: state.status,
      hasContent: state.status === 'ready',
    })
  }

  const hidden = () => {
    suspended = true
    pause()
  }

  const shown = () => {
    suspended = false
    scan()
  }

  const mutations = new MutationObserver(scan)
  mutations.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-reader-active', 'data-reader-request', 'data-reader-status'],
  })
  document.addEventListener('visibilitychange', scan)
  window?.addEventListener('pagehide', hidden)
  window?.addEventListener('pageshow', shown)
  scan()

  return () => {
    mutations.disconnect()
    document.removeEventListener('visibilitychange', scan)
    window?.removeEventListener('pagehide', hidden)
    window?.removeEventListener('pageshow', shown)
    pause()
  }
}

export const browserReaderLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const service = yield* Observability
    const root = document.body

    if (!root) return
    yield* Effect.acquireRelease(
      Effect.sync(() => observeReader(root, journeyObserver(service))),
      (dispose) => Effect.sync(dispose),
    )
  }),
)
