import { ImportPreview, ListeningDocument } from '@gbfm/api/listening'
import { Schema } from 'effect'

export const ListeningPage = Schema.Struct({
  document: ListeningDocument,
  workspace: Schema.Boolean,
  preview: Schema.NullOr(ImportPreview),
  error: Schema.NullOr(Schema.String),
})

export type ListeningPage = typeof ListeningPage.Type
