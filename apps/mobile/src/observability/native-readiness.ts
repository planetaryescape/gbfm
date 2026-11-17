import { Option, Schema } from 'effect'

const NativeSettings = Schema.Struct({
  enabled: Schema.Literal(true),
  dsn: Schema.String,
  release: Schema.String,
  environment: Schema.String,
})

export const decodeNativeTelemetry = Schema.decodeUnknownOption(NativeSettings)

export const nativeTelemetryMatches = (
  config: {
    readonly dsn: string | undefined
    readonly release: string | undefined
    readonly environment: string
  },
  native: Option.Option<typeof NativeSettings.Type>,
): boolean =>
  Option.match(native, {
    onNone: () => false,
    onSome: (settings) =>
      settings.dsn === config.dsn &&
      settings.release === config.release &&
      settings.environment === config.environment,
  })
