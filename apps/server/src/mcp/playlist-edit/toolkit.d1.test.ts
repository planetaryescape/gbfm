import { eq } from 'drizzle-orm'
import { Layer, Redacted, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { DatabaseLayer } from '@/db/layer'
import {
  musicPlaylistsTable,
  musicPlaylistTracksTable,
  musicTracksTable,
} from '@/db/music-entity.schema'
import { oauthResource } from '@/db/oauth.schema'
import { makeMcpRoutes } from '@/http/editorial-mcp.routes'
import { AuthLive } from '@/lib/auth'
import { MdxServiceLayer } from '@/lib/mdx'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuthLive } from '@/services/editorial-oauth.service'
import { EmailDeliveryLive } from '@/services/email-delivery.service'
import { RecordingEmailTransportLayer } from '@/services/email-transport.service'
import { PostServiceLayer } from '@/services/post.service'
import { UnavailableObjectStoreClientLayer } from '@/services/storage/object-store-client'
import { UploadAssetServiceLayer } from '@/services/upload-asset.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'

import { McpOperationStoreLayer } from '../operations/store'
import { PlaylistCommandResult } from './contracts'
import { PlaylistEditHandlersLayer, PlaylistEditToolkit } from './toolkit'

const Envelope = Schema.Struct({
  result: Schema.optional(
    Schema.Struct({
      isError: Schema.optional(Schema.Boolean),
      structuredContent: Schema.optional(Schema.Unknown),
      content: Schema.optional(
        Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
      ),
    }),
  ),
  error: Schema.optional(Schema.Unknown),
})

test('real OAuth MCP commands enforce separate publication consent, replay and competing revisions', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const db = fixture.db
  await db.update(user).set({ role: 'admin' }).where(eq(user.id, 'owner'))
  await db.update(oauthResource).set({
    allowedScopes: JSON.stringify(['playlists:write', 'playlists:publish', 'offline_access']),
  })
  const client = await fixture.register('playlists:write playlists:publish offline_access')

  const grant = async (scope: string) =>
    Schema.decodeUnknownSync(OAuthTokens)(
      await (
        await fixture.exchange(
          client,
          await fixture.authorize(client, 'owner', `${scope} offline_access`),
        )
      ).json(),
    ).access_token

  const writer = await grant('playlists:write')
  const publisher = await grant('playlists:write playlists:publish')

  const base = Layer.mergeAll(
    Layer.succeed(ConfigService, {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
      },
    }),
    MdxServiceLayer,
    UploadAssetServiceLayer,
    UnavailableObjectStoreClientLayer,
    McpOperationStoreLayer(db.$client),
  ).pipe(Layer.provideMerge(DatabaseLayer(db.$client)))

  const services = Layer.mergeAll(
    base,
    PostServiceLayer.pipe(Layer.provide(base)),
    EditorialOAuthLive.pipe(Layer.provide(base)),
    AuthLive.pipe(
      Layer.provide(EmailDeliveryLive.pipe(Layer.provide(RecordingEmailTransportLayer))),
      Layer.provide(base),
    ),
  )

  const app = HttpRouter.toWebHandler(
    makeMcpRoutes(PlaylistEditToolkit, PlaylistEditHandlersLayer).pipe(
      Layer.provide(services),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  )

  try {
    const rpc = async (name: string, args: Schema.Json, token = writer, expectedStatus = 200) => {
      const response = await app.handler(
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

      const text = await response.text()
      expect(response.status).toBe(expectedStatus)
      expect(response.headers.get('cache-control')).toBe('private, no-store')

      const payload =
        text.startsWith('event:') || text.startsWith('data:')
          ? text
              .split('\n')
              .find((line) => line.startsWith('data:'))
              ?.slice(5)
          : text

      return Schema.decodeUnknownSync(Schema.fromJsonString(Envelope))(payload || '{}')
    }

    const result = (body: typeof Envelope.Type) => {
      expect(body.error).toBeUndefined()
      expect(body.result?.isError).not.toBe(true)

      return Schema.decodeUnknownSync(PlaylistCommandResult)(body.result?.structuredContent)
    }

    const failure = (body: typeof Envelope.Type) => {
      expect(body.result?.isError).toBe(true)

      return Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.Struct({ code: Schema.String })),
      )(body.result?.content?.[0]?.text ?? '').code
    }

    const create = {
      operation: 'create_playlist',
      requestId: crypto.randomUUID(),
      metadata: {
        title: 'OAuth playlist',
        slug: 'oauth-playlist',
        description: null,
        coverImageUrl: null,
      },
    }

    const created = result(await rpc('create_playlist', create))
    expect(created).toMatchObject({ revision: 0, membershipCount: 0, replayed: false })
    expect(result(await rpc('create_playlist', create))).toEqual({ ...created, replayed: true })

    const hiddenPublication = await rpc('update_playlist', {
      operation: 'update_playlist',
      playlistId: created.playlistId,
      expectedRevision: 0,
      requestId: crypto.randomUUID(),
      metadata: { title: 'Hidden publication', publishedAt: 1 },
    })

    expect(
      hiddenPublication.error !== undefined || hiddenPublication.result?.isError === true,
    ).toBe(true)
    expect((await db.select().from(musicPlaylistsTable))[0]?.title).toBe('OAuth playlist')
    await db.insert(musicTracksTable).values([
      { id: 'last', title: 'Last', slug: 'last' },
      { id: 'first', title: 'First', slug: 'first' },
    ])

    const add = {
      operation: 'add_playlist_tracks',
      requestId: crypto.randomUUID(),
      playlistId: created.playlistId,
      expectedRevision: 0,
      trackIds: ['last', 'first'],
    }

    expect(
      failure(
        await rpc('add_playlist_tracks', {
          ...add,
          requestId: crypto.randomUUID(),
          trackIds: ['missing'],
        }),
      ),
    ).toBe('invalid_input')
    expect((await db.select().from(musicPlaylistsTable))[0]?.revision).toBe(0)
    const preview = await rpc('preview_playlist_changes', {
      operation: 'preview_playlist_changes',
      command: add,
    })

    expect(preview.result?.isError).not.toBe(true)
    expect(preview.result?.structuredContent).toMatchObject({
      changed: true,
      revision: 1,
      before: { members: [] },
      after: {
        publishedAt: null,
        members: [
          { trackId: 'last', position: 0, addedAt: expect.any(Number) },
          { trackId: 'first', position: 1, addedAt: expect.any(Number) },
        ],
      },
    })
    expect(await db.select().from(musicPlaylistTracksTable)).toHaveLength(0)
    const added = result(await rpc('add_playlist_tracks', add))
    expect(added).toMatchObject({ revision: 1, membershipCount: 2 })
    const target = { playlistId: created.playlistId, expectedRevision: 1 }

    const edits = await Promise.all([
      rpc('reorder_playlist_tracks', {
        operation: 'reorder_playlist_tracks',
        ...target,
        requestId: crypto.randomUUID(),
        trackIds: ['first', 'last'],
      }),
      rpc('remove_playlist_tracks', {
        operation: 'remove_playlist_tracks',
        ...target,
        requestId: crypto.randomUUID(),
        trackIds: ['first'],
      }),
    ])

    expect(edits.filter((edit) => edit.result?.isError !== true)).toHaveLength(1)
    expect(failure(edits.find((edit) => edit.result?.isError === true) ?? {})).toBe('conflict')

    const memberships = await db
      .select()
      .from(musicPlaylistTracksTable)
      .orderBy(musicPlaylistTracksTable.position)

    expect(memberships.map((member) => member.trackId)).toEqual(
      memberships.length === 1 ? ['last'] : ['first', 'last'],
    )

    const publish = {
      operation: 'publish_playlist',
      playlistId: created.playlistId,
      expectedRevision: 2,
      requestId: crypto.randomUUID(),
    }

    expect(failure(await rpc('publish_playlist', publish))).toBe('access_denied')
    expect((await db.select().from(musicPlaylistsTable))[0]?.publishedAt).toBeNull()
    const published = result(await rpc('publish_playlist', publish, publisher))
    expect(published.revision).toBe(3)
    expect(result(await rpc('add_playlist_tracks', add))).toEqual({ ...added, replayed: true })
    await db.update(user).set({ banned: true }).where(eq(user.id, 'owner'))
    // A ban invalidates the persisted credential at transport admission, before receipt disclosure.
    expect(await rpc('publish_playlist', publish, publisher, 401)).toEqual({})
    expect((await db.select().from(musicPlaylistsTable))[0]?.revision).toBe(3)
  } finally {
    await app.dispose()
  }
}, 30_000)
