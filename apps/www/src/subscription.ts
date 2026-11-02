import { Option, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { authSubmitEvents } from './auth-submit'
import { Message } from './message'
import type { Model } from './model'
import { navMinimizeEvents } from './nav-scroll'
import * as Creator from './page/creator'
import { readerRefreshEvents } from './page/tweet/refresh'
import * as Player from './player'
import * as Search from './search'
import { dragEvents } from './sheet-drag'

const menuSubscriptions = Subscription.make<Model, Message>()((entry) => ({
  menuDrag: entry(
    { isDragging: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ isDragging: model.menuDrag !== null }),
      dependenciesToStream: ({ isDragging }) =>
        isDragging
          ? dragEvents<Message>({
              moved: Message.MenuDragMoved,
              released: Message.MenuDragReleased,
              cancelled: Message.MenuDragCancelled,
            })
          : Stream.empty,
    },
  ),
}))

const navSubscriptions = Subscription.make<Model, Message>()((entry) => ({
  navMinimize: entry(
    { active: Schema.Boolean, minimized: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        active: model.interactive && model.player.snapshot.queue.current !== null,
        minimized: model.navMinimized,
      }),
      dependenciesToStream: ({ active, minimized }) =>
        active
          ? navMinimizeEvents<Message>(minimized, (minimized) =>
              Message.NavMinimizeChanged({ minimized }),
            )
          : Stream.empty,
    },
  ),
}))

const authSubscriptions = Subscription.make<Model, Message>()((entry) => ({
  authSubmit: entry(
    { interactive: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ interactive: model.interactive }),
      dependenciesToStream: ({ interactive }) =>
        interactive
          ? authSubmitEvents<Message>({
              submitted: Message.AuthFormSubmitted,
              restored: Message.AuthFormRestored,
            })
          : Stream.empty,
    },
  ),
}))

const readerSubscriptions = Subscription.make<Model, Message>()((entry) => ({
  readerRefresh: entry(
    { active: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        active: model.interactive && model.tweetReader.current !== null,
      }),
      dependenciesToStream: ({ active }) =>
        active
          ? readerRefreshEvents.pipe(
              Stream.map((message) => Message.GotTweetReaderMessage({ message })),
            )
          : Stream.empty,
    },
  ),
}))

export const subscriptions = Subscription.aggregate(
  menuSubscriptions,
  navSubscriptions,
  authSubscriptions,
  readerSubscriptions,
  Subscription.lift(Search.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.search),
    toParentMessage: (message) => Message.GotSearchMessage({ message }),
  }),
  Subscription.lift(Player.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.player),
    toParentMessage: (message) => Message.GotPlayerMessage({ message }),
  }),
  Subscription.lift(Creator.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.creator),
    toParentMessage: (message) => Message.GotCreatorMessage({ message }),
  }),
)
