import { UiSchema } from '@effect/ui'
import { Schema } from 'effect'

export const LibraryAction = Schema.Literals([
  'save',
  'delete',
  'import',
  'add',
  'remove',
  'reorder',
  'sync',
])

export const LibraryMessage = UiSchema.TaggedEnum({
  ClickedNew: {},
  ClickedBack: {},
  ClickedEdit: { id: Schema.String },
  ClickedDeleteRow: { id: Schema.String },
  UpdatedField: { name: Schema.String, value: Schema.String },
  ToggledDraft: {},
  ClickedRefresh: { offset: Schema.Number },
  ChangedDocument: {},
  ClickedDelete: {},
  ClickedCancelDelete: {},
  ClickedAction: { action: LibraryAction, trackId: Schema.String },
  ClickedMove: { id: Schema.String, direction: Schema.Literals(['up', 'down']) },
  SucceededWrite: {
    action: LibraryAction,
    selected: Schema.NullOr(Schema.String),
    notice: Schema.String,
  },
  FailedWrite: { message: Schema.String },
})
