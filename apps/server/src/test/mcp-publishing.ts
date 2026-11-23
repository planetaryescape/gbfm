import { PostId } from '@gbfm/core/editorial-mcp'
import { Effect, Layer, Redacted, Schema } from 'effect'

import { Database } from '@/db/layer'
import { oauthResource } from '@/db/oauth.schema'
import { CreatorCommandResult } from '@/mcp/creator/contracts'
import { loadEditorialSnapshot } from '@/mcp/editorial-music/snapshot'
import { EditorialMcpSettings, projectPost } from '@/mcp/model'
import { ConfigService } from '@/services/config.service'
import { ObjectStoreClient } from '@/services/storage/object-store-client'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { createTestWebHandler } from '@/test/http-handler'

interface StorageHooks {
  beforeHead?: (key: string) => Promise<void>
  beforeCopy?: (key: string) => Promise<void>
  afterCopy?: (key: string) => Promise<void>
}

interface RpcParameters {
  readonly name?: string
  readonly arguments?: Schema.Json
}

export const publishingFixture = async () => {
  const fixture = await createEditorialOAuthFixture()
  const scopes = 'posts:read drafts:write micros:publish content:publish offline_access'
  const client = await fixture.register(scopes)
  await fixture.db.update(oauthResource).set({ allowedScopes: JSON.stringify(scopes.split(' ')) })

  const tokens = async (scope: string, actor = 'owner') =>
    Schema.decodeUnknownSync(OAuthTokens)(
      await (await fixture.exchange(client, await fixture.authorize(client, actor, scope))).json(),
    )

  const publisher = await tokens(scopes)
  const reader = await tokens('posts:read drafts:write offline_access')
  const objects = new Map<string, string>()
  const copies: Array<{ source: string; destination: string }> = []

  const hooks: StorageHooks = {}

  const unexpected = () => Promise.reject(new Error('Unexpected test storage operation'))

  const storage: ObjectStoreClient = {
    provider: 'r2',
    putObject: unexpected,
    presignPutObject: unexpected,
    deleteObject: unexpected,
    listObjects: unexpected,
    listBuckets: unexpected,
    createMultipartUpload: unexpected,
    presignUploadPart: unexpected,
    completeMultipartUpload: unexpected,
    abortMultipartUpload: unexpected,
    listMultipartParts: unexpected,
    headObject: async (_bucket, key) => {
      await hooks.beforeHead?.(key)
      const body = objects.get(key)

      return body === undefined ? null : { size: body.length, metadata: {} }
    },
    copyObject: async (_bucket, source, destination) => {
      await hooks.beforeCopy?.(destination)
      const body = objects.get(source)

      if (body === undefined) throw new Error('Missing test source')
      objects.set(destination, body)
      copies.push({ source, destination })
      await hooks.afterCopy?.(destination)
    },
  }

  const config = Layer.succeed(ConfigService, {
    ...fixture.config,
    auth: {
      ...fixture.config.auth,
      betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
    },
  })

  const makeHandler = () =>
    createTestWebHandler(
      fixture.database,
      undefined,
      Layer.succeed(ObjectStoreClient, storage),
      undefined,
      config,
    )

  let app = makeHandler()

  const rpc = (method: string, params: RpcParameters, token = publisher.access_token, id = 1) => {
    const headers = new Headers({
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      authorization: `Bearer ${Redacted.value(token)}`,
    })

    if (method === 'tools/call' && params.name !== undefined) headers.set('mcp-name', params.name)

    return app.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params: {
            ...params,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    )
  }

  const call = async (name: string, args: Schema.Json, token = publisher.access_token, id = 1) => {
    const response = await rpc('tools/call', { name, arguments: args }, token, id)
    const text = await response.text()

    return {
      status: response.status,
      body: text.length === 0 ? null : Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text)),
    }
  }

  const result = (body: Schema.Json) =>
    Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.Struct({ structuredContent: CreatorCommandResult }) }),
    )(body).result.structuredContent

  const version = async (postId: string) =>
    Effect.runPromise(
      Effect.flatMap(
        loadEditorialSnapshot(fixture.db, Schema.decodeUnknownSync(PostId)(postId)),
        (snapshot) =>
          projectPost(
            snapshot,
            Schema.decodeUnknownSync(EditorialMcpSettings)({
              readScope: 'posts:read',
              environment: 'test',
              resourceUrl: fixture.config.mcp.resourceUrl,
              frontendUrl: fixture.config.urls.frontend,
            }),
          ),
      ).pipe(Effect.provideService(Database, fixture.db)),
    )

  return {
    ...fixture,
    publisher,
    reader,
    tokens,
    objects,
    copies,
    hooks,
    rpc,
    call,
    result,
    version,
    assetUrl: (key: string) => `${fixture.config.urls.bucketRouter}/user-content/${key}`,
    publicRead: (path: string) =>
      app.handler(new Request(new URL(path, fixture.config.mcp.resourceUrl))),
    restart: async () => {
      await app.dispose()
      app = makeHandler()
    },
    [Symbol.asyncDispose]: async () => {
      await app.dispose()
      await fixture[Symbol.asyncDispose]()
    },
  }
}
