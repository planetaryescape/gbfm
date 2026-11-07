import { MembershipMutationResult, MembershipStateResponse } from '@gbfm/api/favorites'
import { eq } from 'drizzle-orm'
import { Context, Schema } from 'effect'
import { expect, test } from 'vitest'

import { audioTable } from '@/db/audio.schema'
import { session, user } from '@/db/auth.schema'
import { makeDatabaseClient } from '@/db/layer'
import { showsTable } from '@/db/show.schema'
import { makeRecordingEmailTransport } from '@/services/email-transport.service'
import { createTestWebHandler } from '@/test/http-handler'
import { createMigratedD1Database } from '@/test/migrate-d1'

import { createMcpOperationStore, McpOperationStore } from '../operations/store'

test('session HTTP writers share observed revisions, exact renewal-stable receipts and truthful effects', async () => {
  await using resource = await createMigratedD1Database()
  const db = makeDatabaseClient(resource.database)
  const recording = makeRecordingEmailTransport()
  const web = createTestWebHandler(resource.database, recording.layer)
  const context = Context.make(McpOperationStore, createMcpOperationStore(resource.database))
  const audioId = 'af766798-acb5-4d1c-87a5-36c85e677af5'
  const showId = '2f08a0f9-045a-4e41-a37f-c2c234da07cb'
  await db.insert(user).values([
    { id: 'listener', name: 'Listener', email: 'listener@example.test', role: 'user' },
    { id: 'other-listener', name: 'Other', email: 'other-listener@example.test', role: 'admin' },
  ])

  for (const [id, userId] of [
    ['first-session', 'listener'],
    ['renewed-session', 'listener'],
    ['other-session', 'other-listener'],
  ] as const)
    await db.insert(session).values({
      id,
      token: id,
      userId,
      expiresAt: new Date(Date.now() + 86_400_000),
      updatedAt: new Date(),
    })
  await db.insert(audioTable).values({
    id: audioId,
    title: 'Audio',
    slug: 'audio',
    content: '',
    type: 'track',
    url: 'https://example.test/audio',
  })
  await db.insert(showsTable).values({ id: showId, title: 'Show', slug: 'show', content: '' })

  const request = (path: string, method = 'GET', body?: Schema.Json, token = 'first-session') => {
    const init: RequestInit = {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    }

    if (body !== undefined) init.body = JSON.stringify(body)

    return web.handler(new Request(`http://localhost/api${path}`, init), context)
  }

  const mutation = (expectedRevision: number) => ({
    requestId: crypto.randomUUID(),
    expectedRevision,
  })

  const save = async (
    path: string,
    method: string,
    body: Schema.Json,
    expectedRevision: number,
  ) => {
    const response = await request(path, method, body)
    expect(response.status).toBe(200)
    const result = Schema.decodeUnknownSync(MembershipMutationResult)(await response.json())
    expect(result).toMatchObject({ revision: expectedRevision, notifications: 'not_sent' })

    return result
  }

  try {
    const response = await request(`/favorites/show/${showId}/state`)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(Schema.decodeUnknownSync(MembershipStateResponse)(await response.json())).toEqual({
      revision: 0,
      favorited: false,
      subscribed: false,
    })
    const input = { ...mutation(0), showId }
    const initial = await save('/favorites', 'POST', input, 1)
    expect(initial).toMatchObject({ targetKind: 'show', targetId: showId, desiredState: true })
    await db.delete(session).where(eq(session.id, 'first-session'))
    expect((await request('/favorites', 'POST', input)).status).toBe(401)
    const replay = await request('/favorites', 'POST', input, 'renewed-session')
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(initial)
    // All following first-party writes use the same owner guard across a renewed credential.
    await db.insert(session).values({
      id: 'first-session',
      token: 'first-session',
      userId: 'listener',
      expiresAt: new Date(Date.now() + 86_400_000),
      updatedAt: new Date(),
    })
    expect((await request(`/shows/${showId}/unsubscribe`, 'DELETE', mutation(0))).status).toBe(409)
    await save(`/shows/${showId}/unsubscribe`, 'DELETE', mutation(1), 2)
    expect(await (await request(`/favorites/show/${showId}/state`)).json()).toEqual({
      revision: 2,
      favorited: true,
      subscribed: false,
    })
    await save(`/shows/${showId}/subscribe`, 'POST', mutation(2), 3)
    await save(`/favorites/show/${showId}`, 'DELETE', mutation(3), 4)
    await save('/favorites', 'POST', { ...mutation(4), audioId }, 5)
    const listed = await (await request('/favorites')).json()
    expect(listed).toMatchObject({ favorites: [{ audioId, membershipRevision: 5 }] })
    await save(`/favorites/${audioId}`, 'DELETE', mutation(5), 6)
    expect(await (await request(`/favorites/audio/${audioId}/state`)).json()).toEqual({
      revision: 6,
      favorited: false,
      subscribed: null,
    })
    expect(
      await (
        await request(`/favorites/show/${showId}/state`, 'GET', undefined, 'other-session')
      ).json(),
    ).toEqual({ revision: 0, favorited: false, subscribed: false })
    expect((await request('/favorites', 'POST', { ...mutation(6), audioId, showId })).status).toBe(
      400,
    )
    await db.update(showsTable).set({ draft: true }).where(eq(showsTable.id, showId))
    expect((await request('/favorites', 'POST', input)).status).toBe(403)
    expect((await request(`/favorites/show/${showId}/state`)).status).toBe(404)
    expect(recording.messages).toEqual([])
  } finally {
    await web.dispose()
  }
}, 30_000)
