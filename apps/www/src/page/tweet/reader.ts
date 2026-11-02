import { MicroPostNeighboursResponse, MicroPostSeenResponse } from '@gbfm/api/navigation'
import { Data, Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { Checkpoint, parseCheckpoint, readPosition, savePosition } from './position'

export { Checkpoint, parseCheckpoint } from './position'

export const isEntry = (href: string) => {
  const url = new URL(href, 'https://goosebumps.fm')

  return ['/tweets', '/tweet'].includes(url.pathname) && !url.searchParams.has('q')
}

export const concreteSlug = (href: string) => {
  const url = new URL(href, 'https://goosebumps.fm')
  const match = /^\/tweet\/([^/]+)$/.exec(url.pathname)

  try {
    const slug = match?.[1] ? parseCheckpoint(decodeURIComponent(match[1])) : null

    return slug && !['latest', 'new'].includes(slug) ? slug : null
  } catch {
    return null
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

  return neighbours.unreadCount === 0 && neighbours.newerUnread === null
    ? UnreadTarget.CaughtUp()
    : UnreadTarget.Unavailable()
}

export const Model = Schema.Struct({
  identity: Schema.String,
  checkpoint: Schema.NullOr(Checkpoint),
  resumeSlug: Schema.NullOr(Checkpoint),
  current: Schema.NullOr(Checkpoint),
  navigationId: Schema.Number,
  revision: Schema.Number,
  requestId: Schema.Number,
  pending: Schema.Array(Schema.String),
  recorded: Schema.Array(Schema.String),
  failed: Schema.Array(Schema.String),
  neighbours: Schema.NullOr(MicroPostNeighboursResponse),
  lastKnown: Schema.NullOr(MicroPostNeighboursResponse),
  metadataStatus: Schema.Literals(['loading', 'ready', 'error']),
})

export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  EntryResolved: {
    slug: Schema.NullOr(Checkpoint),
    navigationId: Schema.Number,
    identity: Schema.String,
  },
  Stored: {},
  Seen: { slug: Schema.String, identity: Schema.String },
  SeenFailed: { slug: Schema.String, identity: Schema.String },
  RetrySeen: {},
  RetryNavigation: {},
  LoadedNavigation: {
    identity: Schema.String,
    neighbours: MicroPostNeighboursResponse,
    navigationId: Schema.Number,
    revision: Schema.Number,
    requestId: Schema.Number,
  },
  FailedNavigation: {
    identity: Schema.String,
    navigationId: Schema.Number,
    revision: Schema.Number,
    requestId: Schema.Number,
  },
})

export type Message = typeof Message.Type

export const ResolveEntry = Command.define('TweetReader.ResolveEntry', {
  args: {
    checkpoint: Schema.NullOr(Checkpoint),
    navigationId: Schema.Number,
    identity: Schema.String,
  },
  messages: [Message.EntryResolved],
  execute: ({ checkpoint, navigationId, identity }) =>
    Effect.sync(() =>
      Message.EntryResolved({ slug: checkpoint ?? readPosition(identity), navigationId, identity }),
    ),
})

export const StoreCheckpoint = Command.define('TweetReader.StoreCheckpoint', {
  args: { slug: Schema.NullOr(Checkpoint), identity: Schema.String },
  messages: [Message.Stored],
  execute: ({ slug, identity }) =>
    Effect.sync(() => {
      savePosition(identity, slug)

      return Message.Stored()
    }),
})

const MarkSeen = Command.define('TweetReader.MarkSeen', {
  args: { slug: Schema.String, identity: Schema.String },
  messages: [Message.Seen, Message.SeenFailed],
  execute: ({ slug, identity }) =>
    Effect.tryPromise(async (signal) => {
      const response = await fetch(`/api/content/posts/micro/${encodeURIComponent(slug)}/seen`, {
        method: 'POST',
        credentials: 'same-origin',
        signal,
      })

      if (!response.ok) throw new Error('Seen write unavailable')

      return response.json()
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(MicroPostSeenResponse)),
      Effect.map(({ recorded }) =>
        recorded ? Message.Seen({ slug, identity }) : Message.SeenFailed({ slug, identity }),
      ),
      Effect.orElseSucceed(() => Message.SeenFailed({ slug, identity })),
    ),
})

const LoadNavigation = Command.define('TweetReader.LoadNavigation', {
  args: {
    identity: Schema.String,
    slug: Schema.String,
    navigationId: Schema.Number,
    revision: Schema.Number,
    requestId: Schema.Number,
  },
  messages: [Message.LoadedNavigation, Message.FailedNavigation],
  execute: ({ slug, ...token }) =>
    Effect.tryPromise(async (signal) => {
      const response = await fetch(
        `/api/content/posts/micro/${encodeURIComponent(slug)}/neighbours`,
        {
          credentials: 'same-origin',
          signal,
        },
      )

      if (!response.ok) throw new Error('Navigation unavailable')

      return response.json()
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(MicroPostNeighboursResponse)),
      Effect.map((neighbours) => Message.LoadedNavigation({ ...token, neighbours })),
      Effect.orElseSucceed(() => Message.FailedNavigation(token)),
    ),
})

export const init = (identity: string): Model => ({
  identity,
  checkpoint: null,
  resumeSlug: null,
  current: null,
  navigationId: 0,
  revision: 0,
  requestId: 0,
  pending: [],
  recorded: [],
  failed: [],
  neighbours: null,
  lastKnown: null,
  metadataStatus: 'loading',
})

const refresh = (model: Model): Update.Return<Model, Message> => {
  if (!model.current || model.pending.length) return { model }
  const requestId = model.requestId + 1

  return {
    model: { ...model, requestId, metadataStatus: 'loading' },
    commands: [
      LoadNavigation({
        identity: model.identity,
        slug: model.current,
        navigationId: model.navigationId,
        revision: model.revision,
        requestId,
      }),
    ],
  }
}

const beginSeen = (model: Model, slug: string): Update.Return<Model, Message> => ({
  model: {
    ...model,
    pending: [...model.pending, slug],
    failed: model.failed.filter((candidate) => candidate !== slug),
    revision: model.revision + 1,
  },
  commands: [MarkSeen({ slug, identity: model.identity })],
})

export const visit = (
  model: Model,
  slug: string,
  navigationId: number,
  initial: MicroPostNeighboursResponse | null,
  rootMonth: string | null,
): Update.Return<Model, Message> => {
  if (model.current === slug && model.navigationId === navigationId)
    return {
      model: { ...model, checkpoint: slug, resumeSlug: null },
      commands: [StoreCheckpoint({ slug, identity: model.identity })],
    }

  const neighbours =
    initial && !initial.seen && rootMonth
      ? {
          ...initial,
          seen: true,
          timeline: initial.timeline.map((month) =>
            month.month === rootMonth ? { ...month, unread: Math.max(0, month.unread - 1) } : month,
          ),
        }
      : initial

  const next = {
    ...model,
    checkpoint: slug,
    resumeSlug: null,
    current: slug,
    navigationId,
    neighbours,
    lastKnown: neighbours ?? model.neighbours ?? model.lastKnown,
    metadataStatus: 'loading' as const,
  }

  const seen =
    model.pending.includes(slug) || model.recorded.includes(slug)
      ? refresh(next)
      : beginSeen(next, slug)

  return {
    ...seen,
    commands: [StoreCheckpoint({ slug, identity: model.identity }), ...(seen.commands ?? [])],
  }
}

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    EntryResolved: () => ({ model }),
    Stored: () => ({ model }),
    RetrySeen: () =>
      model.current &&
      model.failed.includes(model.current) &&
      !model.pending.includes(model.current)
        ? beginSeen(model, model.current)
        : { model },
    RetryNavigation: () => refresh(model),
    Seen: ({ slug, identity }) => {
      if (identity !== model.identity || !model.pending.includes(slug)) return { model }

      return refresh({
        ...model,
        revision: model.revision + 1,
        pending: model.pending.filter((candidate) => candidate !== slug),
        recorded: [...model.recorded, slug],
      })
    },
    SeenFailed: ({ slug, identity }) => {
      if (identity !== model.identity || !model.pending.includes(slug)) return { model }

      return refresh({
        ...model,
        revision: model.revision + 1,
        pending: model.pending.filter((candidate) => candidate !== slug),
        failed: [...model.failed, slug],
      })
    },
    LoadedNavigation: ({ neighbours, navigationId, revision, requestId, identity }) =>
      identity === model.identity &&
      navigationId === model.navigationId &&
      revision === model.revision &&
      requestId === model.requestId &&
      !model.pending.length
        ? { model: { ...model, neighbours, lastKnown: neighbours, metadataStatus: 'ready' } }
        : { model },
    FailedNavigation: ({ navigationId, revision, requestId, identity }) =>
      identity === model.identity &&
      navigationId === model.navigationId &&
      revision === model.revision &&
      requestId === model.requestId &&
      !model.pending.length
        ? { model: { ...model, neighbours: null, metadataStatus: 'error' } }
        : { model },
  })
