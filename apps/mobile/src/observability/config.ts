export const telemetryConfig = (input: {
  readonly dsn: string | undefined
  readonly enabled: string | undefined
  readonly environment: string | undefined
  readonly release: string | undefined
  readonly development: boolean
}) => {
  let dsn: string | undefined

  try {
    const parsed = new URL(input.dsn ?? '')

    if (
      parsed.protocol === 'https:' &&
      parsed.username &&
      !parsed.password &&
      /^\/[0-9]+$/.test(parsed.pathname) &&
      !parsed.search &&
      !parsed.hash
    )
      dsn = parsed.href
  } catch {
    dsn = undefined
  }

  const environment =
    input.environment === 'production' || input.environment === 'preview'
      ? input.environment
      : input.environment === 'development' || input.development
        ? 'development'
        : 'production'

  const release = /^gbfm-mobile@[a-f0-9]{40}$/.test(input.release ?? '') ? input.release : undefined

  return {
    dsn,
    enabled: input.enabled === 'true' && dsn !== undefined && release !== undefined,
    environment,
    release,
    tracesSampleRate: 1,
  }
}
