import { Schema } from 'effect'

const DocumentBootstrap = Schema.Struct({
  kind: Schema.Literal('routed'),
  url: Schema.String,
  realm: Schema.NonEmptyString,
})

export const parseDocumentBootstrap = Schema.decodeUnknownSync(
  Schema.fromJsonString(DocumentBootstrap),
)

export const parseDocumentState = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
)
