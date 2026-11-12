import { Option, Schema, type Logger } from 'effect'

type EffectLogMessage = Logger.Options<unknown>['message']

type LogValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<LogValue>
  | { readonly [key: string]: LogValue }

const SensitiveKey = /password|token|authorization|cookie|secret|email|session/i

const Scalar = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null])

const RecordValue = Schema.Record(Schema.String, Schema.Unknown)

export function redactLogValue(value: EffectLogMessage, depth = 0): LogValue {
  if (depth > 4) return '[Truncated]'

  if (value === undefined) return undefined

  if (Array.isArray(value)) return value.map((entry) => redactLogValue(entry, depth + 1))

  const record = Schema.decodeUnknownOption(RecordValue)(value)

  if (Option.isSome(record)) {
    return Object.fromEntries(
      Object.entries(record.value).map(([key, entry]) => [
        key,
        SensitiveKey.test(key) ? '[Redacted]' : redactLogValue(entry, depth + 1),
      ]),
    )
  }

  return Option.getOrElse(Schema.decodeUnknownOption(Scalar)(value), () => '[Unsupported]')
}

export function formatLogMessage(value: EffectLogMessage): string {
  const message = Schema.decodeUnknownOption(Schema.String)(value)

  if (Option.isSome(message)) return message.value

  if (Array.isArray(value)) return value.map(formatLogMessage).join(' ')

  return JSON.stringify(redactLogValue(value)) ?? ''
}
