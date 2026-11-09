import { UserId } from '@gbfm/core/identity'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { expect, test } from 'vitest'

import { audioTable } from '@/db/audio.schema'
import { user } from '@/db/auth.schema'
import { favoritesTable } from '@/db/favorites.schema'
import { listeningCollectionsTable, savedMixesTable } from '@/db/listening.schema'
import { musicReminder } from '@/db/music-reminder.schema'
import { oauthResource } from '@/db/oauth.schema'
import { showSubscriptionsTable, showsTable } from '@/db/show.schema'
import { AdminOverviewResult } from '@/mcp/admin-read'
import { EndpointIdentity } from '@/mcp/contracts'
import {
  ListFavoritesResult,
  ListShowSubscriptionsResult,
  SetMembershipResult,
} from '@/mcp/favorites/contracts'
import { CollectionPage, SavedMixPage } from '@/mcp/listening/contracts'
import { ListMusicRemindersResult } from '@/mcp/reminders/contracts'
import { ConfigService } from '@/services/config.service'
import { makeRecordingEmailTransport } from '@/services/email-transport.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { createTestWebHandler } from '@/test/http-handler'

const ToolList = Schema.Struct({
  result: Schema.Struct({
    tools: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
})

test('central owned reads and membership commands isolate grants and owners under disposable policy', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const readScopes = 'listening:read favorites:read subscriptions:read reminders:read'
  const writeScopes = 'listening:write favorites:write subscriptions:write reminders:write'
  const allScopes = `${readScopes} ${writeScopes} admin:read posts:read offline_access`
  const client = await fixture.register(allScopes)

  const refused = await fixture.request(
    `/oauth2/authorize?${fixture.authorizationQuery(client, `${readScopes} offline_access`)}`,
    undefined,
    'reader',
  )

  expect(refused.status).toBe(400)

  // Only disposable policy is enabled; the default resource definition stays unchanged.
  await fixture.db
    .update(oauthResource)
    .set({ allowedScopes: JSON.stringify(allScopes.split(' ')) })
  await fixture.db.update(user).set({ role: 'admin' }).where(eq(user.id, 'other'))

  const tokens = async (actor: string, scope: string) =>
    Schema.decodeUnknownSync(OAuthTokens)(
      await (
        await fixture.exchange(
          client,
          await fixture.authorize(client, actor, `${scope} offline_access`),
        )
      ).json(),
    )

  const reader = await tokens('reader', readScopes)
  const writer = await tokens('reader', writeScopes)
  const admin = await tokens('other', `${readScopes} ${writeScopes} admin:read posts:read`)

  await fixture.db.insert(showsTable).values([
    { id: 'owned-show', slug: 'owned-show', title: 'Public show', content: 'DO NOT RENDER' },
    {
      id: 'private-show',
      slug: 'private-show',
      title: 'SECRET SHOW',
      content: 'SECRET',
      draft: true,
    },
  ])
  await fixture.db.insert(audioTable).values([
    {
      id: 'owned-mix',
      slug: 'owned-mix',
      title: 'Public mix',
      type: 'mix',
      content: 'DO NOT RENDER',
      url: 'https://media.test/never.mp3',
    },
    {
      id: 'private-mix',
      slug: 'private-mix',
      title: 'SECRET MIX',
      type: 'mix',
      draft: true,
      content: 'SECRET',
      url: 'https://media.test/private.mp3',
    },
  ])

  for (const actor of ['reader', 'other']) {
    await fixture.db.insert(savedMixesTable).values({
      id: `${actor}-save`,
      userId: actor,
      title: `${actor} save`,
      url: `https://soundcloud.com/disposable/${actor}`,
      platform: 'soundcloud',
      notes: `${actor} private notes`,
    })
    await fixture.db.insert(listeningCollectionsTable).values({
      id: `${actor}-collection`,
      userId: actor,
      title: `${actor} private collection`,
    })
    await fixture.db.insert(favoritesTable).values([
      { userId: actor, audioId: 'owned-mix' },
      { userId: actor, audioId: 'private-mix' },
    ])
    await fixture.db.insert(showSubscriptionsTable).values([
      { userId: actor, showId: 'owned-show' },
      { userId: actor, showId: 'private-show' },
    ])
    await fixture.db.insert(musicReminder).values({
      id: `${actor}-reminder`,
      userId: actor,
      musicTitle: `${actor} reminder`,
      artistName: 'Artist',
      musicUrl: 'https://secret.test/reminder',
      notes: `${actor} SECRET reminder notes`,
      reminderDate: new Date('2030-01-02T03:04:05Z'),
    })
  }

  const snapshot = () =>
    Promise.all([
      fixture.db.select().from(savedMixesTable),
      fixture.db.select().from(listeningCollectionsTable),
      fixture.db.select().from(favoritesTable),
      fixture.db.select().from(showSubscriptionsTable),
      fixture.db.select().from(musicReminder),
      fixture.db.select().from(audioTable),
    ])

  const before = await snapshot()
  const email = makeRecordingEmailTransport()

  const app = createTestWebHandler(
    fixture.db.$client,
    email.layer,
    undefined,
    undefined,
    Layer.succeed(ConfigService, {
      ...fixture.config,
      auth: {
        ...fixture.config.auth,
        betterAuthSecret: 'disposable-test-secret-with-at-least-32-chars',
      },
    }),
  )

  const rpc = (token: typeof reader.access_token, name?: string, args: Schema.Json = {}) =>
    app.handler(
      new Request(fixture.config.mcp.resourceUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': name ? 'tools/call' : 'tools/list',
          'mcp-name': name ?? '',
          authorization: `Bearer ${Redacted.value(token)}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 17,
          method: name ? 'tools/call' : 'tools/list',
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

  const privateNames = [
    'list_saved_mixes',
    'list_collections',
    'list_favorites',
    'list_show_subscriptions',
    'list_music_reminders',
  ]

  const membershipCommands = ['set_favorite', 'set_show_subscription']

  const listed = async (token: typeof reader.access_token) =>
    Schema.decodeUnknownSync(ToolList)(await (await rpc(token)).json()).result.tools.map(
      ({ name }) => name,
    )

  try {
    expect(await listed(reader.access_token)).toEqual(privateNames)
    expect(await listed(writer.access_token)).toEqual(membershipCommands)
    // Both read AND write grants expose the two implemented setters, not other pending commands.
    expect((await listed(admin.access_token)).toSorted()).toEqual(
      [
        'list_drafts',
        'get_post',
        ...privateNames,
        ...membershipCommands,
        'get_admin_overview',
      ].toSorted(),
    )

    for (const name of privateNames) {
      expect(await (await rpc(writer.access_token, name)).json()).toMatchObject({
        result: {
          isError: true,
          content: [{ text: expect.stringContaining('access_denied') }],
        },
      })
    }

    for (const name of membershipCommands) {
      expect(await (await rpc(reader.access_token, name)).json()).toMatchObject({
        result: { isError: true, content: [{ text: expect.stringContaining('access_denied') }] },
      })
    }

    const saved = Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.Struct({ structuredContent: SavedMixPage }) }),
    )(await (await rpc(reader.access_token, 'list_saved_mixes')).json()).result.structuredContent

    expect(saved.mixes.map(({ id, notes }) => ({ id, notes }))).toEqual([
      { id: 'reader-save', notes: 'reader private notes' },
    ])

    const collections = Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.Struct({ structuredContent: CollectionPage }) }),
    )(await (await rpc(reader.access_token, 'list_collections')).json()).result.structuredContent

    expect(collections.collections.map(({ id }) => id)).toEqual(['reader-collection'])

    const favorites = Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.Struct({ structuredContent: ListFavoritesResult }) }),
    )(await (await rpc(reader.access_token, 'list_favorites')).json()).result.structuredContent

    expect(favorites.favorites.map(({ target }) => target.id)).toEqual(['owned-mix'])

    const subscriptions = Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.Struct({ structuredContent: ListShowSubscriptionsResult }) }),
    )(await (await rpc(reader.access_token, 'list_show_subscriptions')).json()).result
      .structuredContent

    expect(subscriptions.subscriptions.map(({ show }) => show.id)).toEqual(['owned-show'])
    const remindersBody = await (await rpc(reader.access_token, 'list_music_reminders')).text()
    expect(remindersBody).not.toMatch(/SECRET|other-reminder|musicUrl|notes|secret\.test/)

    const reminders = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          result: Schema.Struct({
            structuredContent: ListMusicRemindersResult,
          }),
        }),
      ),
    )(remindersBody).result.structuredContent

    expect(reminders.reminders.map(({ id }) => id)).toEqual(['reader-reminder'])

    const overview = Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.Struct({ structuredContent: AdminOverviewResult }) }),
    )(await (await rpc(admin.access_token, 'get_admin_overview')).json()).result.structuredContent

    expect(overview.publishing.mixes).toEqual({ published: 1, drafts: 1 })
    expect(overview.endpoint).toEqual(favorites.endpoint)

    const editorial = Schema.decodeUnknownSync(
      Schema.Struct({
        result: Schema.Struct({
          structuredContent: Schema.Struct({
            endpoint: EndpointIdentity,
          }),
        }),
      }),
    )(await (await rpc(admin.access_token, 'list_drafts')).json()).result.structuredContent

    expect(overview.endpoint).toEqual(editorial.endpoint)
    expect(await snapshot()).toEqual(before)
    expect(email.messages).toEqual([])

    // The same real OAuth/Worker composition must execute, not merely list, the
    // registered setters. Reuse observed owner revisions and uncertain request IDs.
    const intent = {
      targetKind: 'audio',
      targetId: 'owned-mix',
      desiredState: false,
      expectedRevision: favorites.revision,
      requestId: crypto.randomUUID(),
    }

    const mutation = Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.Struct({ structuredContent: SetMembershipResult }) }),
    )(await (await rpc(writer.access_token, 'set_favorite', intent)).json()).result
      .structuredContent

    expect(mutation).toMatchObject({ desiredState: false, revision: 1, notifications: 'not_sent' })
    expect(await (await rpc(writer.access_token, 'set_favorite', intent)).json()).toMatchObject({
      result: { structuredContent: mutation },
    })

    const unsubscribe = Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.Struct({ structuredContent: SetMembershipResult }) }),
    )(
      await (
        await rpc(writer.access_token, 'set_show_subscription', {
          showId: 'owned-show',
          desiredState: false,
          expectedRevision: mutation.revision,
          requestId: crypto.randomUUID(),
        })
      ).json(),
    ).result.structuredContent

    expect(unsubscribe).toMatchObject({
      desiredState: false,
      revision: 2,
      notifications: 'not_sent',
    })
    expect(
      await (
        await rpc(writer.access_token, 'set_favorite', {
          ...intent,
          requestId: crypto.randomUUID(),
        })
      ).json(),
    ).toMatchObject({
      result: { isError: true, content: [{ text: expect.stringContaining('conflict') }] },
    })
    expect(email.messages).toEqual([])

    await fixture.db.update(user).set({ role: 'user' }).where(eq(user.id, 'other'))
    expect((await rpc(admin.access_token, 'get_admin_overview')).status).toBe(401)
    await fixture.db.update(user).set({ banned: true }).where(eq(user.id, 'reader'))

    for (const name of privateNames) expect((await rpc(reader.access_token, name)).status).toBe(401)
    await fixture.db.update(user).set({ banned: false }).where(eq(user.id, 'reader'))
    await Effect.runPromise(
      fixture.service.disconnect(Schema.decodeUnknownSync(UserId)('reader'), client),
    )

    for (const name of privateNames) expect((await rpc(reader.access_token, name)).status).toBe(401)
  } finally {
    await app.dispose()
  }
}, 30_000)
