import { UiSchema } from '@effect/ui'
import { DialogInteraction } from '@effect/ui-kit'
import { Schema } from 'effect'

import { Principal } from '../../domain/principal'

export const StationNavigationProps = Schema.Struct({
  url: Schema.String,
  principal: Schema.NullOr(Principal),
  principalKnown: Schema.Boolean,
})

export type StationNavigationProps = typeof StationNavigationProps.Type

export const NavigationEvents = UiSchema.TaggedEnum({
  RequestedSearch: {},
})

export const NavigationMessage = UiSchema.TaggedEnum({
  Ready: {},
  ChangedLocation: { url: Schema.String, principalId: Schema.NullOr(Schema.String) },
  ChangedCollectionsVisibility: { visible: Schema.Boolean },
  RequestedSearch: {},
  OpenedMenu: { method: DialogInteraction },
  ClosedMenu: {},
  SettledMenu: { open: Schema.Boolean },
  OpenedAccount: {},
  ClosedAccount: {},
  SettledAccount: { open: Schema.Boolean },
  ChangedMinimized: { minimized: Schema.Boolean },
  StartedMenuDrag: { pointerId: Schema.Number, clientY: Schema.Number },
  MovedMenuDrag: { pointerId: Schema.Number, clientY: Schema.Number },
  ReleasedMenuDrag: {
    pointerId: Schema.Number,
    clientY: Schema.Number,
    viewportHeight: Schema.Number,
  },
  CancelledMenuDrag: {},
})

export type NavigationMessage = typeof NavigationMessage.Type

export const NavigationModel = Schema.Struct({
  url: Schema.String,
  principalId: Schema.NullOr(Schema.String),
  collectionsVisible: Schema.Boolean,
  interactive: Schema.Boolean,
  menuOpen: Schema.Boolean,
  menuOpenMethod: Schema.NullOr(DialogInteraction),
  menuSettled: Schema.Boolean,
  accountOpen: Schema.Boolean,
  accountSettled: Schema.Boolean,
  minimized: Schema.Boolean,
  menuDrag: Schema.NullOr(Schema.Struct({ pointerId: Schema.Number, startY: Schema.Number })),
  menuOffset: Schema.Number,
})

export type NavigationModel = typeof NavigationModel.Type
