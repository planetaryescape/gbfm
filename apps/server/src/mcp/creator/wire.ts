import { Effect, Option, type Schema } from 'effect'

import { type EndpointIdentity, McpToolError } from '../contracts'
import { MAX_MCP_RESPONSE_BYTES, McpWireResponse } from '../wire-response'

/** Mandatory invocation-scoped transport budget, never a guessed RPC identity. */
export const requireCreatorWire = Effect.gen(function* () {
  const wire = yield* Effect.serviceOption(McpWireResponse)

  if (Option.isNone(wire))
    return yield* new McpToolError({
      code: 'unavailable',
      message: 'Creator transport budget unavailable.',
    })

  return wire.value
})

/** false is one byte longer than true, so a first-apply acknowledgement also bounds its replay. */
export const creatorResultFits = (
  wire: McpWireResponse['Service'],
  endpoint: typeof EndpointIdentity.Type,
  target: Schema.Json,
) =>
  wire.successBytes({ endpoint, status: 'applied', replayed: false, target }) <=
  MAX_MCP_RESPONSE_BYTES

/** Read/replay disclosure must fit its own current HTTP request ID and framing too. */
export const checkCreatorResponse = <A extends Schema.Json>(value: A) =>
  Effect.gen(function* () {
    const wire = yield* requireCreatorWire

    if (wire.successBytes(value) > MAX_MCP_RESPONSE_BYTES)
      return yield* new McpToolError({
        code: 'invalid_input',
        message: 'Creator response exceeds the supported byte limit.',
      })

    return value
  })
