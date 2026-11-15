import { createHash } from 'node:crypto'

import { Effect, Layer, Redacted, Schema } from 'effect'
import { Miniflare } from 'miniflare'
import { expect, test } from 'vitest'

import { GetPostResult } from '@/mcp/contracts'
import { PreparedDraftImage } from '@/mcp/draft-artwork/contracts'
import { ConfigService } from '@/services/config.service'
import { R2ObjectStoreClientLayer } from '@/services/storage/r2-object-store-client'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { createTestWebHandler } from '@/test/http-handler'

test('production MCP route attaches owned artwork with persisted OAuth, D1 and R2', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const clientId = await fixture.register()

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await fixture.exchange(
        clientId,
        await fixture.authorize(clientId, 'owner', 'posts:read offline_access drafts:write'),
      )
    ).json(),
  )

  const readonly = Schema.decodeUnknownSync(OAuthTokens)(
    await (await fixture.exchange(clientId, await fixture.authorize(clientId))).json(),
  )

  const runtime = new Miniflare({
    script: 'export default { fetch() { return new Response() } }',
    modules: true,
    r2Buckets: ['ARTWORK'],
  })

  const bucket = await runtime.getR2Bucket('ARTWORK')

  const configuration = Layer.succeed(ConfigService, {
    ...fixture.config,
    auth: {
      ...fixture.config.auth,
      betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
    },
    storage: {
      provider: 'r2',
      region: 'auto',
      accountId: 'fixture-account',
      accessKeyId: Redacted.make('fixture-key'),
      secretAccessKey: Redacted.make('fixture-secret'),
    },
  })

  const handler = createTestWebHandler(
    fixture.db.$client,
    undefined,
    R2ObjectStoreClientLayer({ userContent: bucket, mixes: bucket }).pipe(
      Layer.provide(configuration),
    ),
    undefined,
    configuration,
  )

  const call = (name: string, args: Schema.Json, token = tokens.access_token) =>
    handler.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': name,
          authorization: `Bearer ${Redacted.value(token)}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name,
            arguments: args,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    )

  const Saved = Schema.Struct({ result: Schema.Struct({ structuredContent: GetPostResult }) })

  const Prepared = Schema.Struct({
    result: Schema.Struct({ structuredContent: PreparedDraftImage }),
  })

  try {
    const created = Schema.decodeUnknownSync(Saved)(
      await (
        await call('create_draft', {
          requestId: crypto.randomUUID(),
          title: 'Disposable artwork fixture',
          content: 'Preserved fixture prose.',
        })
      ).json(),
    ).result.structuredContent

    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    )

    const preparation = {
      requestId: crypto.randomUUID(),
      postId: created.post.postId,
      expectedVersion: created.post.version,
      fileName: 'fixture.png',
      contentType: 'image/png',
      fileSize: bytes.length,
      contentMd5: createHash('md5').update(bytes).digest('base64'),
    }

    expect(
      await (await call('prepare_draft_image_upload', preparation, readonly.access_token)).json(),
    ).toMatchObject({
      result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
    })
    const response = await call('prepare_draft_image_upload', preparation)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')

    const prepared = Schema.decodeUnknownSync(Prepared)(await response.json()).result
      .structuredContent

    await bucket.put(prepared.upload.key, bytes, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: { 'artwork-receipt': prepared.upload.assetId },
      onlyIf: { etagDoesNotMatch: '*' },
      md5: Buffer.from(preparation.contentMd5, 'base64'),
    })

    const edit = {
      requestId: crypto.randomUUID(),
      postId: created.post.postId,
      expectedVersion: created.post.version,
      coverUploadRequestId: preparation.requestId,
      banner: { uploadRequestId: preparation.requestId, alt: 'Disposable fixture' },
    }

    expect(
      await (await call('attach_draft_artwork', edit, readonly.access_token)).json(),
    ).toMatchObject({
      result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
    })

    const saved = Schema.decodeUnknownSync(Saved)(
      await (await call('attach_draft_artwork', edit)).json(),
    ).result.structuredContent

    expect(saved.post.thumbnailUrl).toBe(prepared.upload.publicUrl)
    expect(saved.post.content).toBe(
      `![Disposable fixture](${prepared.upload.publicUrl})\n\nPreserved fixture prose.`,
    )
    expect(saved.post.draft).toBe(true)
    expect(
      Schema.decodeUnknownSync(Saved)(await (await call('attach_draft_artwork', edit)).json())
        .result.structuredContent,
    ).toEqual(saved)
    await Effect.runPromise(fixture.service.disconnect(fixture.userId, clientId))
    expect((await call('attach_draft_artwork', edit)).status).toBe(401)
  } finally {
    await handler.dispose()
    await runtime.dispose()
  }
}, 15_000)
