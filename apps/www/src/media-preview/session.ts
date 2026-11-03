import { isPrivateMediaPath } from '@gbfm/core/media-preview'
import { Data, Option, Schema } from 'effect'

const PreviewResponse = Schema.Struct({
  sessionUrl: Schema.String,
  grant: Schema.String,
  expiresAt: Schema.Number,
})

/** Only the reserved private namespace opts into credentialed media requests. */
export const isPrivateMedia = (value: string): boolean => {
  try {
    const url = new URL(value)

    return url.protocol === 'https:' && isPrivateMediaPath(url.pathname)
  } catch {
    return false
  }
}

export type PreviewResult = { readonly ok: true } | { readonly ok: false }

export type PreviewSession = {
  ensure(): Promise<PreviewResult>
  dispose(): void
}

type PreviewState =
  | { readonly _tag: 'Unavailable'; readonly lastAttempt: number }
  | { readonly _tag: 'RequestingGrant'; readonly pending: Promise<PreviewResult> }
  | { readonly _tag: 'InstallingCredentials'; readonly pending: Promise<PreviewResult> }
  | {
      readonly _tag: 'Granted'
      readonly expiresAt: number
      readonly lastAttempt: number
      readonly timer: ReturnType<typeof setTimeout>
    }
  | { readonly _tag: 'Denied'; readonly lastAttempt: number }
  | { readonly _tag: 'Disposed' }

const PreviewState = Data.taggedEnum<PreviewState>()

type SettledPreview = Extract<PreviewState, { readonly lastAttempt: number }>

/** Owns one active path, never the media element or its src. No token is retained. */
export const createPreviewSession = (
  url: string,
  dependencies: {
    readonly fetch: typeof fetch
    readonly now: () => number
    readonly onDenied: () => void
    readonly document?: Pick<Document, 'addEventListener' | 'removeEventListener'> & {
      readonly visibilityState?: DocumentVisibilityState
    }
    readonly window?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  },
): PreviewSession => {
  const controller = new AbortController()
  let state: PreviewState = PreviewState.Unavailable({ lastAttempt: -Infinity })

  const request = async (lastAttempt: number): Promise<PreviewResult> => {
    if (controller.signal.aborted) return { ok: false }

    try {
      const response = await dependencies.fetch('/api/upload/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      })

      if (!response.ok) throw new Error('Preview denied')
      const parsed = Schema.decodeUnknownOption(PreviewResponse)(await response.json())

      if (controller.signal.aborted) return { ok: false }

      if (Option.isNone(parsed)) throw new Error('Invalid preview response')
      const grant = parsed.value
      const endpoint = new URL(grant.sessionUrl)
      const media = new URL(url)

      if (
        endpoint.origin !== media.origin ||
        endpoint.pathname !== '/preview-session' ||
        endpoint.search !== '' ||
        endpoint.hash !== '' ||
        !Number.isFinite(grant.expiresAt) ||
        grant.expiresAt <= dependencies.now()
      )
        throw new Error('Invalid preview response')

      if (!PreviewState.$is('RequestingGrant')(state)) return { ok: false }
      state = PreviewState.InstallingCredentials({ pending: state.pending })

      const installed = await dependencies.fetch(endpoint.href, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant: grant.grant }),
        signal: controller.signal,
      })

      if (!installed.ok) throw new Error('Preview denied')

      if (controller.signal.aborted) return { ok: false }
      state = PreviewState.Granted({
        expiresAt: grant.expiresAt,
        lastAttempt,
        timer: setTimeout(
          () => {
            void refresh()
          },
          Math.max(5_000, grant.expiresAt - dependencies.now() - 180_000),
        ),
      })

      return { ok: true }
    } catch {
      if (!controller.signal.aborted) {
        state = PreviewState.Denied({ lastAttempt })
        dependencies.onDenied()
      }

      return { ok: false }
    }
  }

  const startRequest = (previous: SettledPreview): Promise<PreviewResult> => {
    const expiresAt = PreviewState.$is('Granted')(previous) ? previous.expiresAt : 0
    const lastAttempt = dependencies.now()

    if (lastAttempt - previous.lastAttempt < 5_000)
      return Promise.resolve({ ok: expiresAt > dependencies.now() })

    if (PreviewState.$is('Granted')(previous)) clearTimeout(previous.timer)
    const pending = Promise.resolve().then(() => request(lastAttempt))
    state = PreviewState.RequestingGrant({ pending })

    return pending
  }

  const refresh = (): Promise<PreviewResult> =>
    PreviewState.$match(state, {
      Unavailable: startRequest,
      Denied: startRequest,
      Granted: startRequest,
      RequestingGrant: ({ pending }) => pending,
      InstallingCredentials: ({ pending }) => pending,
      Disposed: () => Promise.resolve<PreviewResult>({ ok: false }),
    })

  const resume = () => {
    if (dependencies.document?.visibilityState !== 'hidden') void refresh()
  }

  dependencies.document?.addEventListener('visibilitychange', resume)
  dependencies.window?.addEventListener('online', resume)

  return {
    ensure: () =>
      PreviewState.$is('Granted')(state) && state.expiresAt > dependencies.now()
        ? Promise.resolve({ ok: true })
        : refresh(),
    dispose: () => {
      if (PreviewState.$is('Granted')(state)) clearTimeout(state.timer)
      state = PreviewState.Disposed()
      controller.abort()
      dependencies.document?.removeEventListener('visibilitychange', resume)
      dependencies.window?.removeEventListener('online', resume)
    },
  }
}

export const previewDeniedEvent = 'gbfm:media-preview-denied'

export const browserPreviewSession = (url: string, onDenied?: () => void) =>
  createPreviewSession(url, {
    fetch: (...args) => fetch(...args),
    now: Date.now,
    document,
    window,
    onDenied: () => {
      onDenied?.()
      window.dispatchEvent(new Event(previewDeniedEvent))
    },
  })
