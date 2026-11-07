import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import { McpScope } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Context, Effect, Layer, Match, Option, Redacted, Schema, Stream } from 'effect'
import { McpSchema, type Tool, type Toolkit } from 'effect/ai'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'

import { Database } from '@/db/layer'
import { oauthResource } from '@/db/oauth.schema'
import { Auth } from '@/lib/auth'
import { McpPermission } from '@/mcp/authorization'
import { ContentReadServiceLayer } from '@/mcp/content-read/service'
import { ContentReadHandlersLayer, ContentReadToolkit } from '@/mcp/content-read/toolkit'
import { EditorialToolError } from '@/mcp/contracts'
import { EditorialDraftServiceLayer } from '@/mcp/drafts'
import { EditorialActor, EditorialMcpConfig, EditorialReadServiceLayer } from '@/mcp/editorial'
import { EditorialMcpSettings } from '@/mcp/model'
import {
  composeMcpToolkits,
  EditorialToolkit,
  EditorialToolHandlersLayer,
  makeMcpLayer,
} from '@/mcp/server'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuth, EditorialOAuthUnavailable } from '@/services/editorial-oauth.service'

const BearerHeader = Schema.String.check(
  Schema.isMaxLength(1100),
  Schema.isPattern(/^Bearer [A-Za-z0-9._~+/-]+=*$/i),
)

const McpCredential = Schema.TaggedUnion({
  Missing: {},
  Malformed: {},
  Bearer: { token: Schema.Redacted(Schema.NonEmptyString) },
})

const parseCredential = (authorization: string | undefined) =>
  Match.value(authorization).pipe(
    Match.when(undefined, () => McpCredential.cases.Missing.make({})),
    Match.orElse((header) =>
      Option.match(Schema.decodeUnknownOption(BearerHeader)(header), {
        onNone: () => McpCredential.cases.Malformed.make({}),
        onSome: (value) =>
          McpCredential.cases.Bearer.make({ token: Redacted.make(value.slice(7)) }),
      }),
    ),
  )

const noStore = (response: HttpServerResponse.HttpServerResponse) =>
  HttpServerResponse.setHeader(response, 'cache-control', 'private, no-store')

const boundMcpBody = Effect.fn('EditorialMcp.boundBody')(function* <E>(
  stream: Stream.Stream<Uint8Array, E>,
  maximum: number,
) {
  let size = 0
  const chunks: Array<Uint8Array> = []
  yield* Stream.runForEachWhile(stream, (chunk) =>
    Effect.sync(() => {
      size += chunk.byteLength

      if (size > maximum) return false
      chunks.push(chunk)

      return true
    }),
  )

  if (size > maximum) return Option.none()
  const body = new Uint8Array(size)
  let offset = 0

  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return Option.some(body)
})

const MAX_MCP_JSON_BYTES = 256 * 1024

const ToolCallRequest = Schema.Struct({
  id: Schema.optional(Schema.Unknown),
  method: Schema.Literal('tools/call'),
  params: Schema.Struct({ name: Schema.String }),
})

const ToolListing = Schema.StructWithRest(
  Schema.Struct({
    result: Schema.StructWithRest(
      Schema.Struct({
        tools: Schema.Array(
          Schema.StructWithRest(Schema.Struct({ name: Schema.String }), [
            Schema.Record(Schema.String, Schema.Unknown),
          ]),
        ),
      }),
      [Schema.Record(Schema.String, Schema.Unknown)],
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

export const makeMcpRoutes = <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* ConfigService
      const settings = config.mcp

      if (!settings)
        return config.mcpConfigurationError
          ? HttpRouter.add(
              '*',
              '/mcp',
              HttpServerResponse.empty({
                status: 503,
                headers: { 'cache-control': 'private, no-store' },
              }),
            )
          : Layer.empty

      const oauth = yield* EditorialOAuth
      const auth = yield* Auth
      const db = yield* Database
      const origin = new URL(settings.resourceUrl).origin
      const origins = [origin, new URL(config.urls.frontend).origin]
      const resourceMetadata = `${origin}/.well-known/oauth-protected-resource/mcp`
      const challenge = `Bearer resource_metadata="${resourceMetadata}", scope="posts:read"`

      const unauthorized = Effect.succeed(
        HttpServerResponse.empty({
          status: 401,
          headers: { 'www-authenticate': challenge, 'cache-control': 'private, no-store' },
        }),
      )

      const admission = HttpRouter.middleware(
        (httpEffect) =>
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            const path = new URL(request.url, origin).pathname

            if (path !== '/mcp') return yield* httpEffect

            if (request.headers.origin && !origins.includes(request.headers.origin))
              return noStore(HttpServerResponse.empty({ status: 403 }))

            return yield* Match.value(parseCredential(request.headers.authorization)).pipe(
              Match.tag('Missing', () => unauthorized),
              Match.tag('Malformed', () => unauthorized),
              Match.tag('Bearer', ({ token }) =>
                oauth.verify(token).pipe(
                  Effect.matchEffect({
                    onFailure: (failure) =>
                      Match.value(failure).pipe(
                        Match.tag('EditorialOAuthInvalidToken', () => unauthorized),
                        Match.tag('EditorialOAuthUnavailable', () =>
                          Effect.succeed(noStore(HttpServerResponse.empty({ status: 503 }))),
                        ),
                        Match.exhaustive,
                      ),
                    onSuccess: (principal) =>
                      Effect.gen(function* () {
                        const bounded =
                          request.method === 'POST'
                            ? yield* boundMcpBody(
                                request.stream,
                                principal.scopes.includes('drafts:write')
                                  ? MAX_MCP_JSON_BYTES
                                  : 16 * 1024,
                              )
                            : Option.some(new Uint8Array())

                        if (Option.isNone(bounded))
                          return noStore(HttpServerResponse.empty({ status: 413 }))

                        const visible = new Set(
                          Object.values(toolkit.tools)
                            .filter((tool) => {
                              const permission = Context.getOption(tool.annotations, McpPermission)

                              return (
                                Option.isSome(permission) &&
                                permission.value.scopes.every((scope) =>
                                  principal.scopes.includes(scope),
                                )
                              )
                            })
                            .map((tool) => tool.name),
                        )

                        const call = Schema.decodeUnknownOption(
                          Schema.fromJsonString(ToolCallRequest),
                        )(new TextDecoder().decode(bounded.value))

                        // The installed transport executes id-less calls too. Admission must
                        // cover them, not merely fully formed JSON-RPC requests.
                        const response =
                          Option.isSome(call) &&
                          Object.values(toolkit.tools).some(
                            (tool) => tool.name === call.value.params.name,
                          ) &&
                          !visible.has(call.value.params.name)
                            ? yield* HttpServerResponse.json({
                                jsonrpc: '2.0',
                                id: Schema.decodeUnknownOption(McpSchema.RequestId)(
                                  call.value.id,
                                ).pipe(Option.getOrNull),
                                result: {
                                  isError: true,
                                  content: [
                                    {
                                      type: 'text',
                                      text: JSON.stringify(
                                        new EditorialToolError({
                                          code: 'access_denied',
                                          message: 'MCP access denied.',
                                        }),
                                      ),
                                    },
                                  ],
                                },
                              }).pipe(Effect.map(noStore), Effect.orDie)
                            : yield* httpEffect.pipe(
                                Effect.provideService(EditorialActor, principal),
                                Effect.provideService(
                                  HttpServerRequest.HttpServerRequest,
                                  request.method === 'POST'
                                    ? HttpServerRequest.fromWeb(
                                        new Request(new URL(request.url, origin), {
                                          method: request.method,
                                          headers: request.headers,
                                          body: bounded.value,
                                        }),
                                      )
                                    : request,
                                ),
                                Effect.map(noStore),
                              )

                        // Buffer only the bounded response; never truncate a private body.
                        const web = HttpServerResponse.toWeb(response)
                        const responseBody = web.body

                        if (!responseBody) return response

                        const body = yield* boundMcpBody(
                          Stream.fromReadableStream({
                            evaluate: () => responseBody,
                            onError: () => new EditorialOAuthUnavailable(),
                          }),
                          MAX_MCP_JSON_BYTES,
                        )

                        if (Option.isNone(body))
                          return noStore(
                            HttpServerResponse.text(
                              'MCP response exceeds the supported byte limit.',
                              { status: 413 },
                            ),
                          )
                        const text = new TextDecoder().decode(body.value)

                        const filterListing = (json: string) => {
                          const listing = Schema.decodeUnknownOption(
                            Schema.fromJsonString(ToolListing),
                          )(json)

                          return Option.isSome(listing)
                            ? JSON.stringify({
                                ...listing.value,
                                result: {
                                  ...listing.value.result,
                                  tools: listing.value.result.tools.filter((tool) =>
                                    visible.has(tool.name),
                                  ),
                                },
                              })
                            : json
                        }

                        const filtered = response.headers['content-type']?.includes(
                          'text/event-stream',
                        )
                          ? text
                              .split('\n')
                              .map((line) =>
                                line.startsWith('data:')
                                  ? `data: ${filterListing(line.slice(5).trimStart())}`
                                  : line,
                              )
                              .join('\n')
                          : filterListing(text)

                        return noStore(
                          HttpServerResponse.text(filtered, {
                            status: response.status,
                            headers: response.headers,
                            contentType: response.headers['content-type'],
                          }),
                        )
                      }),
                  }),
                ),
              ),
              Match.exhaustive,
            )
          }),
        { global: true },
      )

      const protectedMetadata = () =>
        Effect.gen(function* () {
          const [resource] = yield* Effect.tryPromise({
            try: () =>
              db
                .select({
                  disabled: oauthResource.disabled,
                  allowedScopes: oauthResource.allowedScopes,
                })
                .from(oauthResource)
                .where(eq(oauthResource.identifier, settings.resourceUrl))
                .limit(1),
            catch: () => new EditorialOAuthUnavailable(),
          })

          const policy = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              disabled: Schema.NullOr(Schema.Boolean),
              allowedScopes: Schema.NullOr(Schema.fromJsonString(Schema.Array(McpScope))),
            }),
          )(resource).pipe(Effect.mapError(() => new EditorialOAuthUnavailable()))

          if (policy.disabled) return yield* Effect.fail(new EditorialOAuthUnavailable())

          return yield* HttpServerResponse.json({
            resource: settings.resourceUrl,
            authorization_servers: [settings.issuer],
            scopes_supported: [
              ...new Set(
                Object.values(toolkit.tools).flatMap((tool) =>
                  Context.getOption(tool.annotations, McpPermission).pipe(
                    Option.map((permission) => permission.scopes),
                    Option.getOrElse(() => []),
                  ),
                ),
              ),
            ]
              .filter(
                (scope) =>
                  // Match authorizeAccount's legacy draft-write downscoping exception.
                  scope === 'drafts:write' ||
                  policy.allowedScopes === null ||
                  policy.allowedScopes.includes(scope),
              )
              .sort(),
            bearer_methods_supported: ['header'],
          }).pipe(Effect.orDie)
        }).pipe(
          Effect.catchTag('EditorialOAuthUnavailable', () =>
            Effect.succeed(HttpServerResponse.empty({ status: 503 })),
          ),
          Effect.map(noStore),
        )

      const authorizationMetadata = () =>
        Effect.tryPromise({
          try: () =>
            oauthProviderAuthServerMetadata(auth)(
              new Request(`${origin}/.well-known/oauth-authorization-server/auth`),
            ),
          catch: () => new EditorialOAuthUnavailable(),
        }).pipe(
          Effect.map(HttpServerResponse.fromWeb),
          Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 503 }))),
          Effect.map(noStore),
        )

      const endpoint = yield* Schema.decodeUnknownEffect(EditorialMcpSettings)({
        readScope: 'posts:read',
        environment: settings.resourceUrl.includes('.localhost/') ? 'local' : config.app.stage,
        resourceUrl: settings.resourceUrl,
        frontendUrl: config.urls.frontend,
      }).pipe(Effect.mapError(() => new EditorialOAuthUnavailable()))

      const endpointConfig = Layer.succeed(EditorialMcpConfig, endpoint)

      return Layer.mergeAll(
        admission,
        HttpRouter.add('GET', '/.well-known/oauth-protected-resource', protectedMetadata),
        HttpRouter.add('GET', '/.well-known/oauth-protected-resource/mcp', protectedMetadata),
        HttpRouter.add('GET', '/.well-known/oauth-authorization-server', authorizationMetadata),
        HttpRouter.add(
          'GET',
          '/.well-known/oauth-authorization-server/auth',
          authorizationMetadata,
        ),
        makeMcpLayer(origins, toolkit).pipe(
          Layer.provide(ContentReadHandlersLayer),
          Layer.provide(ContentReadServiceLayer),
          Layer.provide(EditorialToolHandlersLayer),
          Layer.provide(EditorialDraftServiceLayer),
          Layer.provide(EditorialReadServiceLayer),
          Layer.provide(endpointConfig),
        ),
      )
    }),
  )

export const EditorialMcpRoutesLive = makeMcpRoutes(
  composeMcpToolkits(EditorialToolkit, ContentReadToolkit),
)

export function privateEditorialResponse(request: Request, response: Response): Response {
  const path = new URL(request.url).pathname

  if (
    path !== '/mcp' &&
    !path.startsWith('/api/user/mcp-connections') &&
    !path.startsWith('/auth/oauth2/')
  )
    return response

  const headers = new Headers(response.headers)
  headers.set('cache-control', 'private, no-store')

  return new Response(response.body, { status: response.status, headers })
}
