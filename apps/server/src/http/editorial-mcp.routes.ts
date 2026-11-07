import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import { Effect, Layer, Match, Option, Redacted, Schema, Stream } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'

import { Auth } from '@/lib/auth'
import { EditorialDraftServiceLayer } from '@/mcp/drafts'
import { EditorialActor, EditorialMcpConfig, EditorialReadServiceLayer } from '@/mcp/editorial'
import { EditorialMcpSettings } from '@/mcp/model'
import { makeEditorialMcpLayer } from '@/mcp/server'
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

const boundMcpBody = Effect.fn('EditorialMcp.boundBody')(function* (
  request: HttpServerRequest.HttpServerRequest,
  origin: string,
  maximum: number,
) {
  if (request.method !== 'POST') return Option.some(request)
  let size = 0
  const chunks: Array<Uint8Array> = []
  yield* Stream.runForEachWhile(request.stream, (chunk) =>
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

  return Option.some(
    HttpServerRequest.fromWeb(
      new Request(new URL(request.url, origin), {
        method: request.method,
        headers: request.headers,
        body,
      }),
    ),
  )
})

export const EditorialMcpRoutesLive = Layer.unwrap(
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
                      const bounded = yield* boundMcpBody(
                        request,
                        origin,
                        (principal.scopes.includes('drafts:write') ? 640 : 16) * 1024,
                      )

                      if (Option.isNone(bounded))
                        return noStore(HttpServerResponse.empty({ status: 413 }))

                      return yield* httpEffect.pipe(
                        Effect.provideService(EditorialActor, principal),
                        Effect.provideService(HttpServerRequest.HttpServerRequest, bounded.value),
                        Effect.map(noStore),
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
      HttpServerResponse.json({
        resource: settings.resourceUrl,
        authorization_servers: [settings.issuer],
        scopes_supported: ['posts:read', 'drafts:write'],
        bearer_methods_supported: ['header'],
      }).pipe(Effect.map(noStore), Effect.orDie)

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
      HttpRouter.add('GET', '/.well-known/oauth-authorization-server/auth', authorizationMetadata),
      makeEditorialMcpLayer(origins).pipe(
        Layer.provide(EditorialDraftServiceLayer),
        Layer.provide(EditorialReadServiceLayer),
        Layer.provide(endpointConfig),
      ),
    )
  }),
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
