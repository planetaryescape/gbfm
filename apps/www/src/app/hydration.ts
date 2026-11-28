import { Schema } from 'effect'

import { AppPropsJson } from './props'

export const HydrationState = Schema.StructWithRest(
  Schema.Struct({
    '~deferred': Schema.optional(Schema.Array(Schema.String)),
    '~query': Schema.optional(Schema.Unknown),
    '~reported': Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    '~static': Schema.optional(Schema.Boolean),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

export const jsonScript = (document: Document, id: string) => {
  const element = document.getElementById(id)

  if (element?.tagName !== 'SCRIPT' || element.getAttribute('type') !== 'application/json')
    throw new Error(`Missing application hydration script: ${id}`)

  return element.textContent ?? ''
}

export const readHydration = (document: Document) => ({
  props: Schema.decodeUnknownSync(Schema.fromJsonString(AppPropsJson))(
    jsonScript(document, 'gbfm-ui-props'),
  ),
  state: Schema.decodeUnknownSync(Schema.fromJsonString(HydrationState))(
    jsonScript(document, 'gbfm-ui-state'),
  ),
})
