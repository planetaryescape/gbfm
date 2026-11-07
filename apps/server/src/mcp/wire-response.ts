import { Context, type Schema } from 'effect'
import type { McpSchema } from 'effect/ai'

/** Shared with the installed 2026-07-28 transport; changes require wire-fixture verification. */
export const MCP_SERVER_INFO = {
  name: 'GBFM Editorial',
  version: '1.0.0',
  description: 'Editorial reads and separately authorized draft writes. Publishing stays in GBFM.',
}

export const MAX_MCP_RESPONSE_BYTES = 256 * 1024

export class McpWireResponse extends Context.Service<
  McpWireResponse,
  { readonly successBytes: (value: Schema.Json) => number }
>()('gbfm/mcp/WireResponse') {}

/**
 * A single complete tool result, including duplicated/escaped text and framing. Commands using
 * this budget must not emit progress/notifications: those create additional response messages.
 * No guessed request ID, content truncation, or source-only byte estimate is safe before commit.
 */
export const makeMcpWireResponse = (
  id: typeof McpSchema.RequestId.Type,
  framing: 'json' | 'sse',
): McpWireResponse['Service'] => ({
  successBytes: (value) => {
    const json = JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: {
        _meta: { 'io.modelcontextprotocol/serverInfo': MCP_SERVER_INFO },
        resultType: 'complete',
        content: [{ type: 'text', text: JSON.stringify(value) }],
        structuredContent: value,
        isError: false,
      },
    })

    // Effect 4.0.6 mcpHttpSerialization adds a newline; SSE replaces it with a data frame.
    return new TextEncoder().encode(framing === 'sse' ? `data: ${json}\n\n` : `${json}\n`)
      .byteLength
  },
})
