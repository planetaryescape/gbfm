export const telemetryConfig = (input) => {
  let dsn

  try {
    const parsed = new URL(input.dsn ?? '')

    if (
      parsed.protocol === 'https:' &&
      /^[a-f0-9]+$/i.test(parsed.username) &&
      !parsed.password &&
      /^\/[0-9]+$/.test(parsed.pathname) &&
      !parsed.search &&
      !parsed.hash
    )
      dsn = parsed.href
  } catch {
    dsn = undefined
  }

  let environment = 'production'

  if (input.environment === 'development' || input.development) environment = 'development'

  if (input.environment === 'production' || input.environment === 'preview')
    environment = input.environment

  const release = new RegExp(`^gbfm-${input.application}@[a-f0-9]{40}$`).test(input.release ?? '')
    ? input.release
    : undefined

  return {
    dsn,
    enabled: input.enabled === 'true' && dsn !== undefined && release !== undefined,
    environment,
    release,
    tracesSampleRate: 1,
  }
}
