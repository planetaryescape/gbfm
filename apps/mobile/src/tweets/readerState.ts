import type { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import type { MicroPostScreenResponse } from '@gbfm/api/post'
import { Data } from 'effect'

export type UnreadDestination =
  | { readonly kind: 'older' | 'newer'; readonly slug: string }
  | { readonly kind: 'caught-up' | 'unavailable' }

export const nextUnread = (navigation: MicroPostNeighboursResponse | null): UnreadDestination => {
  if (!navigation) return { kind: 'unavailable' }

  if (navigation.olderUnread) return { kind: 'older', slug: navigation.olderUnread }

  if (navigation.newerUnread) return { kind: 'newer', slug: navigation.newerUnread }

  return {
    kind:
      navigation.unreadCount === 0 && navigation.newerUnread === null ? 'caught-up' : 'unavailable',
  }
}

export type ReaderState = {
  readonly request: number
  readonly screen: MicroPostScreenResponse | null
  readonly navigation: MicroPostNeighboursResponse | null
  readonly status: 'loading' | 'ready' | 'empty' | 'error'
  readonly navigationStatus: 'loading' | 'ready' | 'error'
  readonly progressFailed: boolean
  readonly notice: string | null
  readonly actionBusy: boolean
}

export const initialReaderState: ReaderState = {
  request: 0,
  screen: null,
  navigation: null,
  status: 'loading',
  navigationStatus: 'loading',
  progressFailed: false,
  notice: null,
  actionBusy: false,
}

export type ReaderEvent =
  | { readonly _tag: 'Action'; readonly request: number; readonly busy: boolean }
  | { readonly _tag: 'Started'; readonly request: number }
  | {
      readonly _tag: 'Loaded'
      readonly request: number
      readonly screen: MicroPostScreenResponse | null
    }
  | { readonly _tag: 'Failed'; readonly request: number }
  | { readonly _tag: 'Progress'; readonly request: number; readonly failed: boolean }
  | {
      readonly _tag: 'Navigation'
      readonly request: number
      readonly navigation: MicroPostNeighboursResponse
    }
  | { readonly _tag: 'NavigationFailed'; readonly request: number }
  | { readonly _tag: 'Notice'; readonly request: number; readonly message: string }

export const ReaderEvent = Data.taggedEnum<ReaderEvent>()

export const reduceReader = (state: ReaderState, event: ReaderEvent): ReaderState => {
  if (ReaderEvent.$is('Started')(event))
    return { ...initialReaderState, request: event.request, screen: state.screen }

  if (state.request !== event.request) return state

  return ReaderEvent.$match(event, {
    Action: ({ busy }) => ({ ...state, actionBusy: busy }),
    Loaded: ({ screen }): ReaderState =>
      !screen && state.screen
        ? { ...state, status: 'error' }
        : { ...state, screen, status: screen ? 'ready' : 'empty' },
    Failed: (): ReaderState => ({ ...state, status: 'error' }),
    Progress: ({ failed }) => ({ ...state, progressFailed: failed }),
    Navigation: ({ navigation }): ReaderState => ({
      ...state,
      navigation,
      navigationStatus: 'ready',
    }),
    NavigationFailed: (): ReaderState => ({ ...state, navigationStatus: 'error' }),
    Notice: ({ message }) => ({ ...state, notice: message }),
    Started: () => state,
  })
}

export const readerMonth = (createdAt: string) =>
  new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(createdAt),
  )

export const readerAcceptsAction = (state: ReaderState, request: number, focused: boolean) =>
  focused && state.request === request && state.status === 'ready'
