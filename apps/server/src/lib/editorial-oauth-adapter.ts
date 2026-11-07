import type { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'

export const editorialOAuthAdapter =
  (factory: ReturnType<typeof drizzleAdapter>): ReturnType<typeof drizzleAdapter> =>
  (options) => {
    const adapter = factory(options)

    const create: typeof adapter.create = async (input) => {
      try {
        return await adapter.create(input)
      } catch (error) {
        if (['oauthRefreshToken', 'oauthAccessToken'].includes(input.model)) {
          const seen = new Set<unknown>()
          let cause = error

          while (cause instanceof Error && !seen.has(cause)) {
            seen.add(cause)

            if (
              /^(?:D1_ERROR: )?Editorial grant revoked(?:: SQLITE_CONSTRAINT(?: \(extended: SQLITE_CONSTRAINT_TRIGGER\))?)?$/.test(
                cause.message,
              )
            )
              throw new APIError('BAD_REQUEST', {
                error: 'invalid_grant',
                error_description: 'Editorial grant revoked',
              })
            cause = cause.cause
          }
        }

        throw error
      }
    }

    return { ...adapter, create }
  }
