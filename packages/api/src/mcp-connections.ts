import { McpScope, OAuthClientId } from '@gbfm/core/editorial-mcp'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from 'effect/http-api'

import { AuthMiddleware } from './middleware/auth'

export const McpClientId = OAuthClientId

export const McpConnection = Schema.Struct({
  clientId: McpClientId,
  name: Schema.String,
  scopes: Schema.Array(McpScope),
  createdAt: Schema.String,
})

export const McpConnectionsResponse = Schema.Struct({
  connections: Schema.Array(McpConnection),
})

export const McpConnectionsGroup = HttpApiGroup.make('mcpConnections')
  .add(
    HttpApiEndpoint.get('listConnections', '/api/user/mcp-connections', {
      success: McpConnectionsResponse,
      error: [HttpApiError.Forbidden, HttpApiError.ServiceUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('revokeConnection', '/api/user/mcp-connections/:clientId/revoke', {
      params: { clientId: McpClientId },
      success: Schema.Struct({ success: Schema.Literal(true) }),
      error: [HttpApiError.Forbidden, HttpApiError.ServiceUnavailable],
    }),
  )
  .middleware(AuthMiddleware)
