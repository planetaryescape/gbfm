export const telemetryConfig: (input: {
  readonly application: 'mobile' | 'www'
  readonly dsn: string | undefined
  readonly enabled: string | undefined
  readonly environment: string | undefined
  readonly release: string | undefined
  readonly development: boolean
}) => {
  readonly dsn: string | undefined
  readonly enabled: boolean
  readonly environment: 'development' | 'preview' | 'production'
  readonly release: string | undefined
  readonly tracesSampleRate: number
}
