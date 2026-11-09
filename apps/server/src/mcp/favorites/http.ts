import type { Effect } from 'effect'
import { HttpApiError } from 'effect/http-api'

import type { McpToolError } from '../contracts'

/** HTTP conflicts and expired receipts are not successful saves or automatic retries. */
export const membershipHttpError = (
  error: McpToolError,
): Effect.Effect<
  never,
  | HttpApiError.Forbidden
  | HttpApiError.BadRequest
  | HttpApiError.Conflict
  | HttpApiError.Gone
  | HttpApiError.ServiceUnavailable
> => {
  switch (error.code) {
    case 'access_denied':
      return new HttpApiError.Forbidden()
    case 'invalid_input':
      return new HttpApiError.BadRequest()
    case 'conflict':
      return new HttpApiError.Conflict()
    case 'expired':
      return new HttpApiError.Gone()
    default:
      return new HttpApiError.ServiceUnavailable()
  }
}
