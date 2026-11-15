import { createHash } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { Miniflare } from 'miniflare'
import { expect, test } from 'vitest'

import { oauthResource } from '@/db/oauth.schema'
import { postsTable } from '@/db/post.schema'
import { GetPostResult } from '@/mcp/contracts'
import { PreparedDraftImage } from '@/mcp/draft-artwork/contracts'
import { ConfigService } from '@/services/config.service'
import { R2ObjectStoreClientLayer } from '@/services/storage/r2-object-store-client'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { createTestWebHandler } from '@/test/http-handler'

test.each(['draft', 'published'])(
  'production MCP route edits %s artwork with persisted OAuth, D1 and R2',
  async (mode) => {
    await using fixture = await createEditorialOAuthFixture()

    const scope =
      mode === 'draft'
        ? 'posts:read offline_access drafts:write'
        : 'posts:read offline_access drafts:write creator:write'

    const clientId = await fixture.register(scope)

    if (mode === 'published') {
      await fixture.db.update(oauthResource).set({
        allowedScopes: JSON.stringify([
          'posts:read',
          'offline_access',
          'drafts:write',
          'creator:write',
        ]),
      })
    }

    const tokens = Schema.decodeUnknownSync(OAuthTokens)(
      await (
        await fixture.exchange(clientId, await fixture.authorize(clientId, 'owner', scope))
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
      R2ObjectStoreClientLayer({ userContent: bucket, mixes: bucket }, async (request) => {
        const source = request.headers?.['x-amz-copy-source']

        if (!source) throw new Error('Unexpected storage request')
        const original = await bucket.get(source.split('/').slice(2).join('/'))

        if (!original) throw new Error('Missing private original')
        await bucket.put(request.key, await original.arrayBuffer(), {
          httpMetadata: original.httpMetadata ?? {},
          customMetadata: original.customMetadata ?? {},
        })

        return new Response('<CopyObjectResult><ETag>fixture</ETag></CopyObjectResult>')
      }).pipe(Layer.provide(configuration)),
      undefined,
      configuration,
    )

    let editToken = tokens.access_token

    const call = (name: string, args: Schema.Json, token = editToken) =>
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
      let created = Schema.decodeUnknownSync(Saved)(
        await (
          await call('create_draft', {
            requestId: crypto.randomUUID(),
            title: 'Disposable artwork fixture',
            content: 'Preserved fixture prose.',
          })
        ).json(),
      ).result.structuredContent

      const editPublishedFixture = async () => {
        editToken = Schema.decodeUnknownSync(OAuthTokens)(
          await (
            await fixture.exchange(
              clientId,
              await fixture.authorize(clientId, 'owner', 'posts:read offline_access creator:write'),
            )
          ).json(),
        ).access_token
        await fixture.db
          .update(postsTable)
          .set({ draft: false })
          .where(eq(postsTable.id, created.post.postId))
        created = Schema.decodeUnknownSync(Saved)(
          await (
            await call('get_post', {
              postId: created.post.postId,
            })
          ).json(),
        ).result.structuredContent
        created = Schema.decodeUnknownSync(Saved)(
          await (
            await call('update_post', {
              requestId: crypto.randomUUID(),
              postId: created.post.postId,
              expectedVersion: created.post.version,
              title: 'Edited live fixture',
              content: 'Preserved fixture prose. '.repeat(1_000),
            })
          ).json(),
        ).result.structuredContent
        expect(created.post.title).toBe('Edited live fixture')
        expect(created.post.draft).toBe(false)
        expect(
          await (
            await call(
              'update_draft',
              {
                requestId: crypto.randomUUID(),
                postId: created.post.postId,
                expectedVersion: created.post.version,
                title: 'Must remain draft-only',
              },
              tokens.access_token,
            )
          ).json(),
        ).toMatchObject({
          result: { isError: true, content: [{ text: expect.stringContaining('not_found') }] },
        })
      }

      if (mode === 'published') await editPublishedFixture()

      const prepareTool =
        mode === 'draft' ? 'prepare_draft_image_upload' : 'prepare_post_image_upload'

      const attachTool = mode === 'draft' ? 'attach_draft_artwork' : 'attach_post_artwork'

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
        await (await call(prepareTool, preparation, readonly.access_token)).json(),
      ).toMatchObject({
        result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
      })
      const response = await call(prepareTool, preparation)
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

      expect(await (await call(attachTool, edit, readonly.access_token)).json()).toMatchObject({
        result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
      })

      const saved = Schema.decodeUnknownSync(Saved)(await (await call(attachTool, edit)).json())
        .result.structuredContent

      const deliveryUrl =
        mode === 'draft'
          ? prepared.upload.publicUrl
          : prepared.upload.publicUrl.replace('/private/', '/public/')

      expect(saved.post.thumbnailUrl).toBe(deliveryUrl)
      expect(saved.post.content).toContain(deliveryUrl)
      expect(saved.post.content).toContain('Preserved fixture prose.')
      expect(saved.post.draft).toBe(mode === 'draft')
      expect(
        Schema.decodeUnknownSync(Saved)(await (await call(attachTool, edit)).json()).result
          .structuredContent,
      ).toEqual(saved)
      await Effect.runPromise(fixture.service.disconnect(fixture.userId, clientId))
      expect((await call(attachTool, edit)).status).toBe(401)
    } finally {
      await handler.dispose()
      await runtime.dispose()
    }
  },
  15_000,
)
