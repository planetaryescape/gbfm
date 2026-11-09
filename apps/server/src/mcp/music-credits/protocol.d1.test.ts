import { sql } from 'drizzle-orm'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { expect, test } from 'vitest'

import { user } from '../../db/auth.schema'
import { DatabaseLayer } from '../../db/layer'
import { musicArtistsTable, musicTracksTable } from '../../db/music-entity.schema'
import { oauthResource } from '../../db/oauth.schema'
import { makeMcpRoutes } from '../../http/editorial-mcp.routes'
import { AuthLive } from '../../lib/auth'
import { MdxServiceLayer } from '../../lib/mdx'
import { ConfigService } from '../../services/config.service'
import { EditorialOAuthLive } from '../../services/editorial-oauth.service'
import { EmailDeliveryLive } from '../../services/email-delivery.service'
import { RecordingEmailTransportLayer } from '../../services/email-transport.service'
import { PostServiceLayer } from '../../services/post.service'
import { UnavailableObjectStoreClientLayer } from '../../services/storage/object-store-client'
import { UploadAssetServiceLayer } from '../../services/upload-asset.service'
import { createEditorialOAuthFixture, OAuthTokens } from '../../test/editorial-oauth'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { musicVersion } from '../music-edit/version'
import { McpOperationStoreLayer } from '../operations/store'
import { makeMcpWireResponse } from '../wire-response'
import { MusicFactsWriteResult } from './projection'
import { MusicFactsServiceLive } from './service'
import { MusicFactsHandlersLayer, MusicFactsToolkit } from './toolkit'

// Test-only composition of the real OAuth route and M2 exports. Production registry is unchanged.
const protocol = (f: Awaited<ReturnType<typeof createEditorialOAuthFixture>>) => {
  const base = Layer.mergeAll(
    Layer.succeed(ConfigService, {
      ...f.config,
      auth: { ...f.config.auth, betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars' },
    }),
    MdxServiceLayer,
    UploadAssetServiceLayer,
    UnavailableObjectStoreClientLayer,
    McpOperationStoreLayer(f.database),
    Layer.succeed(
      EditorialMcpConfig,
      Schema.decodeUnknownSync(EditorialMcpSettings)({
        readScope: 'posts:read',
        environment: 'local',
        resourceUrl: f.config.mcp.resourceUrl,
        frontendUrl: f.config.urls.frontend,
      }),
    ),
  ).pipe(Layer.provideMerge(DatabaseLayer(f.database)))

  const email = EmailDeliveryLive.pipe(
    Layer.provide(RecordingEmailTransportLayer),
    Layer.provide(base),
  )

  const services = Layer.mergeAll(
    base,
    PostServiceLayer.pipe(Layer.provide(base)),
    EditorialOAuthLive.pipe(Layer.provide(base)),
    AuthLive.pipe(Layer.provide(email), Layer.provide(base)),
  )

  return HttpRouter.toWebHandler(
    makeMcpRoutes(
      MusicFactsToolkit,
      MusicFactsHandlersLayer.pipe(Layer.provide(MusicFactsServiceLive), Layer.provide(base)),
    ).pipe(Layer.provide(services), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  )
}

const Envelope = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.Boolean,
    structuredContent: Schema.optionalKey(Schema.Json),
    content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })),
  }),
})

test('actual OAuth HTTP M2 apply uses admitted ID, raw input admission and full-wire precommit/replay limits', async () => {
  await using f = await createEditorialOAuthFixture()
  await f.db.update(user).set({ role: 'admin' })
  await f.db.insert(musicArtistsTable).values({ id: 'artist', name: 'Primary', slug: 'primary' })
  await f.db
    .insert(musicTracksTable)
    .values({ id: 'track', title: 'Track', slug: 'track', artistNames: [] })
  const scopes = 'posts:read drafts:write catalogue:read catalogue:write offline_access'
  const clientId = await f.register(scopes)
  // Disposable policy only. No production scope activation is performed by M2.
  await f.db.update(oauthResource).set({ allowedScopes: JSON.stringify(scopes.split(' ')) })

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (await f.exchange(clientId, await f.authorize(clientId, 'owner', scopes))).json(),
  )

  const app = protocol(f)

  const call = async (name: string, args: Schema.Json, id: string | number = 1) => {
    const response = await app.handler(
      new Request(f.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': name,
          authorization: `Bearer ${Redacted.value(tokens.access_token)}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
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

    const text = await response.text()
    expect(response.status).toBe(200)

    return { text, result: Schema.decodeUnknownSync(Schema.fromJsonString(Envelope))(text).result }
  }

  try {
    const version = await Effect.runPromise(
      musicVersion({ entityType: 'track', entityId: 'track', revision: 0 }),
    )

    const command = {
      requestId: crypto.randomUUID(),
      target: { type: 'track', id: 'track' },
      expectedVersion: version,
      credits: [
        {
          creditedName: 'Quoted "é" \\ name',
          role: 'performer',
          sourceLabel: 'Sleeve',
          evidenceNote: 'Page 2',
        },
      ],
    }

    const id = 'rpc"é\\'
    const applied = await call('set_recording_credits', command, id)
    expect(applied.result.isError).toBe(false)
    const saved = Schema.decodeUnknownSync(MusicFactsWriteResult)(applied.result.structuredContent)
    expect(saved).toMatchObject({ status: 'applied', changed: true })
    expect(new TextEncoder().encode(applied.text).byteLength).toBe(
      makeMcpWireResponse(id, 'json').successBytes(saved),
    )

    const hugeId = 'i'.repeat(256 * 1024 - 2048)
    expect((await call('set_recording_credits', command, hugeId)).result).toMatchObject({
      isError: true,
    })

    const newCommand = {
      ...command,
      requestId: crypto.randomUUID(),
      expectedVersion: saved.collection.expectedVersion,
    }

    expect((await call('set_recording_credits', newCommand, hugeId)).result).toMatchObject({
      isError: true,
    })
    // If Tool decoding trims before service admission, this oversized command would wrongly apply.
    expect(
      (
        await call('set_recording_credits', {
          ...newCommand,
          credits: [{ ...command.credits[0], creditedName: `${' '.repeat(140 * 1024)}Name` }],
        })
      ).result,
    ).toMatchObject({ isError: true })

    const missing = await call('set_artist_aliases', {
      requestId: crypto.randomUUID(),
      artistId: 'artist',
      aliases: [],
    })

    expect(missing.result.isError).toBe(true)
    expect(missing.result.content[0]?.text).toContain('precondition_required')
    expect(await f.db.get(sql`SELECT count(*) AS n FROM mcp_operations`)).toEqual({ n: 1 })
    expect(await f.db.get(sql`SELECT revision FROM music_tracks WHERE id='track'`)).toEqual({
      revision: 1,
    })
    expect(await f.db.get(sql`SELECT credited_name FROM music_recording_credits`)).toEqual({
      credited_name: command.credits[0]?.creditedName,
    })
  } finally {
    await app.dispose()
  }
}, 20_000)
