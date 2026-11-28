import { Schema } from 'effect'

export const Principal = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  username: Schema.NullOr(Schema.String),
  image: Schema.optional(Schema.NullOr(Schema.String)),
  role: Schema.NullOr(Schema.String),
})

export type Principal = typeof Principal.Type
