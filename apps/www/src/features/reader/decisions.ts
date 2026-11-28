import type { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import { Data } from 'effect'

import type { ReaderPageModel, ReaderPageProps, VisitDestination, VisitToken } from './contracts'
import { parseCheckpoint } from './location'

export { Checkpoint, checkpointKey, parseCheckpoint } from './location'

export { concreteSlug, isEntry } from './location'

export const initialReader = (identity: string): ReaderPageModel => ({
  identity,
  generation: 0,
  navigationId: -1,
  reserved: null,
  current: null,
  checkpoint: null,
  resumeSlug: null,
  resumeNavigationId: null,
  entryResolved: false,
  entryFallback: false,
  returnSlug: null,
  revision: 0,
  refresh: 0,
  progress: 0,
  lastTimeline: [],
  visits: {},
  visitNavigation: {},
})

export const readerStatus = (props: ReaderPageProps) => {
  if (props.active === false) return 'loading'

  if (props.failure) return 'error'

  if (props.screen || props.posts.length > 0) return 'ready'

  return 'empty'
}

export const reserveVisit = (model: ReaderPageModel, token: VisitDestination): ReaderPageModel => {
  const own =
    model.identity === token.identity
      ? model
      : { ...initialReader(token.identity), generation: model.generation + 1 }

  const slug = parseCheckpoint(token.slug)

  if (own.navigationId === token.navigationId && own.reserved === slug) return own

  return { ...own, navigationId: token.navigationId, reserved: slug, current: null, progress: 0 }
}

export const matchesReservation = (model: ReaderPageModel, token: VisitDestination) =>
  model.identity === token.identity &&
  model.navigationId === token.navigationId &&
  model.reserved === token.slug

export const commitVisit = (model: ReaderPageModel, token: VisitToken): ReaderPageModel => {
  if (
    !matchesReservation(model, token) ||
    token.generation !== model.generation ||
    !parseCheckpoint(token.slug)
  )
    return model

  if (model.current === token.slug) return model
  const state = model.visits[token.slug]
  const needsWrite = state !== 'pending' && state !== 'recorded'

  return {
    ...model,
    current: token.slug,
    checkpoint: token.slug,
    resumeSlug: null,
    resumeNavigationId: null,
    entryFallback: false,
    returnSlug: model.returnSlug === token.slug ? null : model.returnSlug,
    revision: model.revision + Number(needsWrite),
    visits: needsWrite ? { ...model.visits, [token.slug]: 'pending' } : model.visits,
    visitNavigation: needsWrite
      ? { ...model.visitNavigation, [token.slug]: token.navigationId }
      : model.visitNavigation,
  }
}

export const settleVisit = (
  model: ReaderPageModel,
  token: VisitToken,
  recorded: boolean,
): ReaderPageModel => {
  if (
    token.identity !== model.identity ||
    token.generation !== model.generation ||
    token.navigationId !== model.visitNavigation[token.slug] ||
    model.visits[token.slug] !== 'pending'
  )
    return model

  return {
    ...model,
    revision: model.revision + 1,
    visits: { ...model.visits, [token.slug]: recorded ? 'recorded' : 'failed' },
  }
}

export const hasPendingVisits = (model: ReaderPageModel) =>
  Object.values(model.visits).some((state) => state === 'pending')

export const visitedNeighbours = (
  initial: MicroPostNeighboursResponse | null,
  rootMonth: string | null,
): MicroPostNeighboursResponse | null => {
  if (!initial || initial.seen || !rootMonth) return initial

  return {
    ...initial,
    seen: true,
    timeline: initial.timeline.map((month) =>
      month.month === rootMonth ? { ...month, unread: Math.max(0, month.unread - 1) } : month,
    ),
  }
}

type UnreadTarget =
  | { readonly _tag: 'Older'; readonly slug: string }
  | { readonly _tag: 'Newer'; readonly slug: string }
  | { readonly _tag: 'CaughtUp' }
  | { readonly _tag: 'Unavailable' }

export const UnreadTarget = Data.taggedEnum<UnreadTarget>()

export const nextUnread = (neighbours: MicroPostNeighboursResponse | null): UnreadTarget => {
  if (!neighbours) return UnreadTarget.Unavailable()

  if (neighbours.olderUnread) return UnreadTarget.Older({ slug: neighbours.olderUnread })

  if (neighbours.newerUnread) return UnreadTarget.Newer({ slug: neighbours.newerUnread })

  if (neighbours.unreadCount === 0 && neighbours.newerUnread === null)
    return UnreadTarget.CaughtUp()

  return UnreadTarget.Unavailable()
}
