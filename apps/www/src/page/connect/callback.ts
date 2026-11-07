import { Option, Schema } from 'effect'

import type { ConsentState } from './domain'

const unsafeSchemes = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'about:',
  'chrome:',
  'chrome-extension:',
  'moz-extension:',
  'resource:',
  'view-source:',
])

export const NativeCallbackScheme = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9+.-]*:$/),
  Schema.makeFilter(
    (scheme) => !unsafeSchemes.has(scheme) && !['http:', 'https:'].includes(scheme),
  ),
).pipe(Schema.brand('NativeCallbackScheme'))

const FormActionSource = Schema.NonEmptyString.check(
  Schema.isPattern(/^[^\s;,'"\\*\p{Cc}]+$/u),
).pipe(Schema.brand('CallbackFormActionSource'))

export const consentFormActionSource = (
  state: Pick<typeof ConsentState.cases.Verified.Type, 'continuation'>,
) => {
  const raw = new URLSearchParams(state.continuation.query).get('redirect_uri') ?? ''
  const callback = URL.parse(raw)

  if (!callback || callback.username || callback.password || /[\s\p{Cc}]/u.test(raw)) return null

  const source = ['http:', 'https:'].includes(callback.protocol)
    ? `${callback.origin}${callback.pathname}`
    : Option.getOrNull(Schema.decodeUnknownOption(NativeCallbackScheme)(callback.protocol))

  return source ? Option.getOrNull(Schema.decodeUnknownOption(FormActionSource)(source)) : null
}
