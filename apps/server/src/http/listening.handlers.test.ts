import { ListeningDocument } from '@gbfm/api/listening'
import { eq } from 'drizzle-orm'
import { Schema } from 'effect'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { session, user } from '@/db/auth.schema'
import {
  listeningCollectionsTable as collections,
  listeningMembershipsTable as memberships,
  savedMixesTable as mixes,
} from '@/db/listening.schema'
import { db, d1 } from '@/test/database'
import { createTestWebHandler } from '@/test/http-handler'

const web = createTestWebHandler(d1)

const request = (path: string, token?: string, method = 'GET', body?: Schema.Json) => {
  const headers = new Headers({ 'content-type': 'application/json' })

  if (token) headers.set('authorization', `Bearer ${token}`)

  const init: RequestInit = { method, headers }

  if (body !== undefined) init.body = JSON.stringify(body)

  return web.handler(new Request(`http://localhost/api/listening${path}`, init))
}

const document = async (path: string, token?: string) => {
  const response = await request(path, token)
  expect(response.status).toBe(200)

  return Schema.decodeUnknownSync(ListeningDocument)(await response.json())
}

const write = async (
  path: string,
  token: string,
  method: string,
  body?: Schema.Json,
  expected = 200,
) => {
  expect((await request(path, token, method, body)).status).toBe(expected)
}

const save = (token: string, url: string, title: string) =>
  write('/mixes', token, 'POST', { items: [{ url, title }] })

beforeAll(async () => {
  for (const id of ['listener-aya', 'listener-ben']) {
    await db.insert(user).values({ id, name: id, email: `${id}@example.test`, role: 'user' })
    await db.insert(session).values({
      id,
      token: id,
      userId: id,
      expiresAt: new Date(Date.now() + 86400000),
      updatedAt: new Date(),
    })
  }
})

afterAll(() => web.dispose())

test('ordinary users own independent libraries; collection visibility never exposes drafts and ownership cannot be forged', async () => {
  const aya = 'listener-aya'
  const ben = 'listener-ben'
  expect((await request('')).status).toBe(401)
  expect((await request('/mixes', undefined, 'POST', { items: [] })).status).not.toBe(200)
  await save(aya, 'https://youtu.be/abcdefghijk?si=tracking', 'Opening frequencies')
  await save(aya, 'https://soundcloud.com/local-radio/late-night', 'Secret backlog')
  await save(ben, 'https://youtu.be/abcdefghijk', 'Ben’s independent save')
  await write('/collections', aya, 'POST', {
    title: 'After hours',
    description: 'Slow transitions',
    published: true,
  })
  await write('/collections', aya, 'POST', {
    title: 'Private experiments',
    description: 'not public',
    published: false,
  })
  await write('/collections', ben, 'POST', {
    title: 'Ben’s collection',
    description: '',
    published: true,
  })
  const library = await document('', aya)
  expect(library.mixes.map((mix) => mix.title).sort()).toEqual([
    'Opening frequencies',
    'Secret backlog',
  ])
  expect(library.mixes.every((mix) => !mix.published && mix.status === 'to-listen')).toBe(true)
  const mix = library.mixes.find((item) => item.title === 'Opening frequencies')
  const draft = library.mixes.find((item) => item.title === 'Secret backlog')
  const collection = library.collections.find((item) => item.title === 'After hours')
  const privateCollection = library.collections.find((item) => !item.published)
  const otherCollection = (await document('', ben)).collections[0]

  if (!mix || !draft || !collection || !privateCollection || !otherCollection)
    throw new Error('Missing fixtures')

  expect(mix.version).toBe('revision:1')
  expect(collection.version).toBe('revision:1')

  for (const [index, item] of [mix, draft].entries())
    await write(`/collections/${collection.id}/mixes/${item.id}`, aya, 'PUT', {
      included: true,
      expectedVersion: `revision:${index + 1}`,
    })
  await write(`/collections/${collection.id}/mixes/${mix.id}`, aya, 'PUT', {
    included: true,
    expectedVersion: 'revision:3',
  })
  expect((await document('', aya)).memberships).toHaveLength(2)
  expect((await document(`/public/${collection.id}`)).mixes).toEqual([])
  expect((await request(`/public/${privateCollection.id}`, aya)).status).toBe(404)
  expect((await document('/public')).collections.map((item) => item.title)).not.toContain(
    'Private experiments',
  )

  const edit = {
    expectedVersion: 'revision:1',
    title: 'Opening frequencies',
    notes: 'The bass enters at 14:20. <script>not HTML</script>',
    status: 'listening',
    published: true,
  }

  await write(`/mixes/${mix.id}`, aya, 'PUT', edit)
  const published = await document(`/public/${collection.id}`)
  expect(published.mixes.map((item) => item.title)).toEqual(['Opening frequencies'])
  expect(published.mixes[0]?.notes).toBe(edit.notes)
  expect(JSON.stringify(published)).not.toContain('Secret backlog')
  expect(published.mixes[0]).not.toHaveProperty('userId')
  expect(published.mixes[0]).not.toHaveProperty('version')
  expect(published.collections[0]).not.toHaveProperty('version')
  await save(
    aya,
    'https://www.youtube.com/watch?v=abcdefghijk&utm_source=repeat',
    'Do not overwrite',
  )
  expect((await document('', aya)).mixes.find((item) => item.id === mix.id)?.notes).toBe(edit.notes)
  expect((await document('', ben)).mixes[0]?.notes).toBe('')

  await write(`/mixes/${mix.id}`, ben, 'PUT', edit, 404)
  await write(`/mixes/${mix.id}`, ben, 'DELETE', { expectedVersion: 'revision:1' }, 404)
  await write(
    `/collections/${collection.id}`,
    ben,
    'PUT',
    { title: 'stolen', description: '', published: true, expectedVersion: 'revision:1' },
    404,
  )
  await write(
    `/collections/${collection.id}`,
    ben,
    'DELETE',
    { expectedVersion: 'revision:1' },
    404,
  )
  await write(
    `/collections/${otherCollection.id}/mixes/${mix.id}`,
    ben,
    'PUT',
    { included: true, expectedVersion: 'revision:1' },
    404,
  )
  await write(
    `/collections/${collection.id}/mixes/${mix.id}`,
    ben,
    'PUT',
    {
      included: false,
      expectedVersion: 'revision:4',
    },
    404,
  )
  expect((await document('', aya)).memberships).toHaveLength(2)

  await write(
    '/mixes',
    aya,
    'POST',
    {
      items: [
        { url: 'https://youtu.be/12345678901', title: 'Must roll back' },
        { url: 'https://evil.example/mix', title: 'Invalid' },
      ],
    },
    400,
  )
  expect((await document('', aya)).mixes).toHaveLength(2)
  await write(`/mixes/${mix.id}`, aya, 'PUT', { ...edit, published: false }, 409)
  expect((await document('', aya)).mixes.find((item) => item.id === mix.id)?.published).toBe(true)
  await write(`/mixes/${mix.id}`, aya, 'PUT', {
    ...edit,
    published: false,
    expectedVersion: 'revision:2',
  })
  expect((await document(`/public/${collection.id}`)).mixes).toEqual([])
  await write(`/mixes/${mix.id}`, aya, 'DELETE', { expectedVersion: 'revision:3' })
  expect((await document('', aya)).memberships).toHaveLength(1)
  expect(
    (await document('', aya)).collections.find((item) => item.id === collection.id)?.version,
  ).toBe('revision:5')
  await write(
    `/collections/${collection.id}`,
    aya,
    'DELETE',
    { expectedVersion: 'revision:4' },
    409,
  )
  await write(`/collections/${collection.id}`, aya, 'DELETE', { expectedVersion: 'revision:5' })
  expect((await request(`/public/${collection.id}`)).status).toBe(404)
  expect((await document('', aya)).mixes).toHaveLength(1)
  expect((await document('', aya)).memberships).toEqual([])
})

test('bulk capture handles the maximum batch without losing rows and validates boundaries', async () => {
  await write('/mixes', 'listener-ben', 'POST', {
    items: Array.from({ length: 200 }, (_, index) => ({
      url: `https://soundcloud.com/bulk-radio/mix-${index}`,
      title: `Mix ${index}`,
    })),
  })
  expect((await document('', 'listener-ben')).mixes).toHaveLength(201)
  await write(
    '/mixes',
    'listener-ben',
    'POST',
    {
      items: Array.from({ length: 201 }, () => ({
        url: 'https://youtu.be/abcdefghijk',
        title: 'Too many',
      })),
    },
    400,
  )
  await write(
    '/collections',
    'listener-ben',
    'POST',
    { title: '   ', description: '', published: false },
    400,
  )
})

test('delete fanout fails atomically at revision overflow and no-op membership consumes its observed version', async () => {
  const mixId = crypto.randomUUID()
  const collectionIds = [crypto.randomUUID(), crypto.randomUUID()] as const
  await db.insert(mixes).values({
    id: mixId,
    userId: 'listener-aya',
    url: 'https://soundcloud.com/fanout/overflow',
    title: 'Overflow control',
    platform: 'soundcloud',
  })
  await db.insert(collections).values(
    collectionIds.map((id, index) => ({
      id,
      userId: 'listener-aya',
      title: id,
      revision: index === 0 ? 7 : Number.MAX_SAFE_INTEGER,
    })),
  )
  await db
    .insert(memberships)
    .values(collectionIds.map((collectionId) => ({ collectionId, mixId })))
  await write(`/mixes/${mixId}`, 'listener-aya', 'DELETE', { expectedVersion: 'revision:1' }, 409)
  expect(await db.select().from(mixes).where(eq(mixes.id, mixId))).toHaveLength(1)
  expect(await db.select().from(memberships).where(eq(memberships.mixId, mixId))).toHaveLength(2)
  expect(
    (await db.select().from(collections).where(eq(collections.id, collectionIds[0])))[0]?.revision,
  ).toBe(7)

  const path = `/collections/${collectionIds[0]}/mixes/${mixId}`
  await write(path, 'listener-aya', 'PUT', { included: true, expectedVersion: 'revision:7' })
  await write(path, 'listener-aya', 'PUT', { included: false, expectedVersion: 'revision:7' }, 409)
  expect(await db.select().from(memberships).where(eq(memberships.mixId, mixId))).toHaveLength(2)
  expect(
    (await db.select().from(collections).where(eq(collections.id, collectionIds[0])))[0]?.revision,
  ).toBe(8)
})
