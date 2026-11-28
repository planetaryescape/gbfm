import { Schema } from 'effect'

export const PublicActionDocument = Schema.Struct({
  target: Schema.Struct({
    id: Schema.String,
    kind: Schema.Literals(['audio', 'show']),
  }),
  path: Schema.String,
  state: Schema.Literals(['anonymous', 'active', 'inactive', 'unavailable']),
})

export type PublicActionDocument = typeof PublicActionDocument.Type
