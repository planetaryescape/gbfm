import { McpPrincipal } from '@gbfm/core/editorial-mcp'
import { and, eq } from 'drizzle-orm'
import { Clock, Effect, Layer, Result, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import type { Database } from '@/db/layer'
import {
  listeningCollectionsTable as collections,
  listeningMembershipsTable as memberships,
  savedMixesTable as mixes,
} from '@/db/listening.schema'
import {
  deleteListeningItem,
  editListeningMix,
  setListeningMembership,
  writeListeningCollection,
} from '@/services/listening.service'
import { DatabaseTestLayer, db, d1 } from '@/test/database'
import { withTestLayer } from '@/test/effect'

import { McpActor } from '../authorization'
import type { McpToolError } from '../contracts'
import { EditorialMcpConfig } from '../editorial'
import { EditorialMcpSettings } from '../model'
import { McpOperationStoreLayer } from '../operations/store'
import { ListeningCommandService, ListeningCommandServiceLive } from './commands'

const owner = 'l1-command-owner'

const other = 'l1-command-other'

const config = Schema.decodeUnknownSync(EditorialMcpSettings)({
  readScope: 'posts:read',
  environment: 'test',
  resourceUrl: 'https://fixture.test/mcp',
  frontendUrl: 'https://fixture.test',
})

const layer = ListeningCommandServiceLive.pipe(
  Layer.provide(DatabaseTestLayer),
  Layer.provide(McpOperationStoreLayer(d1)),
  Layer.provide(Layer.succeed(EditorialMcpConfig, config)),
)

const actor = (
  userId = owner,
  scopes: typeof McpPrincipal.Type.scopes = ['listening:read', 'listening:write'],
) =>
  Schema.decodeUnknownSync(McpPrincipal)({ userId, clientId: 'listening-command-fixture', scopes })

const run = <A, E>(program: Effect.Effect<A, E, ListeningCommandService>, identity = actor()) =>
  Effect.runPromise(withTestLayer(program, layer).pipe(Effect.provideService(McpActor, identity)))

const denied = <A>(
  program: Effect.Effect<A, McpToolError, ListeningCommandService>,
  identity = actor(),
) => run(Effect.flip(program), identity)

const save = (url: string, requestId = crypto.randomUUID()) =>
  Effect.gen(function* () {
    const commands = yield* ListeningCommandService

    return yield* commands.saveMix({ requestId, url, title: 'Original title' })
  })

beforeAll(async () => {
  await db
    .insert(user)
    .values(
      [owner, other].map((id) => ({ id, name: id, email: `${id}@example.test`, role: 'user' })),
    )
})

test('six commands preserve private state, original replay and CAS across split notes/status edits', async () => {
  const requestId = crypto.randomUUID()
  const url = 'https://soundcloud.com/l1-command/first'

  const [saved, replayed] = await Promise.all([
    run(save(url, requestId)),
    run(save(url, requestId)),
  ])

  expect(replayed).toEqual(saved)
  expect(saved.version).toBe('revision:1')
  expect(
    await db
      .select()
      .from(mixes)
      .where(and(eq(mixes.userId, owner), eq(mixes.url, url))),
  ).toHaveLength(1)
  const noteRequest = crypto.randomUUID()

  const note = Effect.gen(function* () {
    const commands = yield* ListeningCommandService

    return yield* commands.updateListeningNotes({
      requestId: noteRequest,
      mixId: saved.mixId,
      expectedVersion: saved.version,
      notes: 'PRIVATE notes',
    })
  })

  const noted = await run(note)
  expect(noted.version).toBe('revision:2')

  const listened = await run(
    Effect.gen(function* () {
      const commands = yield* ListeningCommandService

      return yield* commands.setListeningStatus({
        requestId: crypto.randomUUID(),
        mixId: saved.mixId,
        expectedVersion: noted.version,
        status: 'listened',
      })
    }),
  )

  expect(listened.version).toBe('revision:3')
  expect(await run(note)).toEqual(noted)
  expect(
    (
      await denied(
        Effect.gen(function* () {
          const commands = yield* ListeningCommandService

          return yield* commands.updateListeningNotes({
            requestId: noteRequest,
            mixId: saved.mixId,
            expectedVersion: saved.version,
            notes: 'Changed retry',
          })
        }),
      )
    ).code,
  ).toBe('conflict')
  const duplicate = await run(save(url))
  expect(duplicate).toEqual(listened)
  const [row] = await db.select().from(mixes).where(eq(mixes.id, saved.mixId))
  expect(row).toMatchObject({
    title: 'Original title',
    notes: 'PRIVATE notes',
    status: 'listened',
    published: false,
    revision: 3,
  })
  expect(JSON.stringify(noted)).not.toContain('PRIVATE')

  const edits = ['one', 'two'].map((notes) =>
    Effect.gen(function* () {
      const commands = yield* ListeningCommandService

      return yield* commands.updateListeningNotes({
        requestId: crypto.randomUUID(),
        mixId: saved.mixId,
        expectedVersion: listened.version,
        notes,
      })
    }).pipe(Effect.result),
  )

  const competing = await Promise.all(edits.map((effect) => run(effect)))
  expect(competing.filter(Result.isSuccess)).toHaveLength(1)
  expect((await db.select().from(mixes).where(eq(mixes.id, saved.mixId)))[0]?.revision).toBe(4)

  const collectionRequest = crypto.randomUUID()

  const create = Effect.gen(function* () {
    const commands = yield* ListeningCommandService

    return yield* commands.createCollection({
      requestId: collectionRequest,
      title: 'Private collection',
      description: 'Original description',
    })
  })

  const [created, retried] = await Promise.all([run(create), run(create)])
  expect(retried).toEqual(created)

  const updated = await run(
    Effect.gen(function* () {
      const commands = yield* ListeningCommandService

      return yield* commands.updateCollection({
        requestId: crypto.randomUUID(),
        collectionId: created.collectionId,
        expectedVersion: created.version,
        description: '',
      })
    }),
  )

  expect(updated.version).toBe('revision:2')
  expect(
    (await db.select().from(collections).where(eq(collections.id, created.collectionId)))[0],
  ).toMatchObject({ title: 'Private collection', description: '', published: false, revision: 2 })
  expect(await run(create)).toEqual(created)
}, 30_000)

test('old include retries never undo newer removal; missing ownership and public targets cannot win CAS', async () => {
  const saved = await run(save('https://soundcloud.com/l1-command/membership'))
  const foreign = await run(save('https://soundcloud.com/l1-command/foreign'), actor(other))

  const created = await run(
    Effect.gen(function* () {
      return yield* (yield* ListeningCommandService).createCollection({
        requestId: crypto.randomUUID(),
        title: 'Membership',
      })
    }),
  )

  const includeRequest = crypto.randomUUID()

  const membership = (
    included: boolean,
    expectedVersion: string,
    requestId = crypto.randomUUID(),
    mixId = saved.mixId,
  ) =>
    Effect.gen(function* () {
      return yield* (yield* ListeningCommandService).setCollectionMembership({
        requestId,
        collectionId: created.collectionId,
        mixId,
        included,
        expectedVersion,
      })
    })

  const included = await run(membership(true, created.version, includeRequest))
  const removed = await run(membership(false, included.version))
  expect(removed.version).toBe('revision:3')
  expect(await run(membership(true, created.version, includeRequest))).toEqual(included)
  expect(
    await db.select().from(memberships).where(eq(memberships.collectionId, created.collectionId)),
  ).toEqual([])
  expect((await denied(membership(true, included.version))).code).toBe('conflict')
  expect(
    (await denied(membership(true, removed.version, crypto.randomUUID(), foreign.mixId))).code,
  ).toBe('conflict')
  const noop = await run(membership(false, removed.version))
  expect(noop.version).toBe('revision:4')
  await db
    .update(mixes)
    .set({ published: true, revision: 2, lastOperationId: null })
    .where(eq(mixes.id, saved.mixId))
  expect((await denied(membership(true, noop.version))).code).toBe('conflict')
  expect(
    (
      await denied(
        Effect.gen(function* () {
          return yield* (yield* ListeningCommandService).updateListeningNotes({
            requestId: crypto.randomUUID(),
            mixId: saved.mixId,
            expectedVersion: 'revision:2',
            notes: 'Cannot publish',
          })
        }),
      )
    ).code,
  ).toBe('conflict')
  expect((await db.select().from(mixes).where(eq(mixes.id, saved.mixId)))[0]?.notes).toBe('')
  expect(
    (await db.select().from(collections).where(eq(collections.id, created.collectionId)))[0]
      ?.revision,
  ).toBe(4)
}, 30_000)

test('replays recheck live account and stored target, and expired create never creates a replacement', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* TestClock.make()

        const program = Effect.gen(function* () {
          const commands = yield* ListeningCommandService
          const input = { requestId: crypto.randomUUID(), title: 'Expires once' }
          yield* clock.setTime(1000)
          const created = yield* commands.createCollection(input)
          yield* clock.setTime(1000 + 86_400_000 - 1)
          expect(yield* commands.createCollection(input)).toEqual(created)
          yield* clock.setTime(1000 + 86_400_000)
          expect((yield* Effect.flip(commands.createCollection(input))).code).toBe('expired')
          yield* clock.setTime(1000 + 86_400_001)
          expect((yield* Effect.flip(commands.createCollection(input))).code).toBe('expired')
          expect(
            yield* Effect.promise(() =>
              db.select().from(collections).where(eq(collections.id, created.collectionId)),
            ),
          ).toHaveLength(1)
        })

        yield* withTestLayer(program, layer).pipe(
          Effect.provideService(McpActor, actor()),
          Effect.provideService(Clock.Clock, clock),
        )
      }),
    ),
  )

  const input = { requestId: crypto.randomUUID(), title: 'Delete then replay' }

  const create = Effect.gen(function* () {
    return yield* (yield* ListeningCommandService).createCollection(input)
  })

  const created = await run(create)
  await db.delete(collections).where(eq(collections.id, created.collectionId))
  expect((await denied(create)).code).toBe('access_denied')
  expect(
    (
      await denied(
        save('https://soundcloud.com/l1-command/scope'),
        actor(owner, ['listening:write']),
      )
    ).code,
  ).toBe('access_denied')
  const bannedRequest = crypto.randomUUID()
  const saved = await run(save('https://soundcloud.com/l1-command/banned', bannedRequest))
  await db.update(user).set({ banned: true }).where(eq(user.id, owner))

  try {
    expect(
      (await denied(save('https://soundcloud.com/l1-command/banned', bannedRequest))).code,
    ).toBe('access_denied')
    expect((await db.select().from(mixes).where(eq(mixes.id, saved.mixId)))[0]?.revision).toBe(1)
  } finally {
    await db.update(user).set({ banned: false }).where(eq(user.id, owner))
  }
}, 30_000)

test('browser writers and MCP share revisions, publication guards and deletion fanout', async () => {
  const saved = await run(save('https://soundcloud.com/l1-command/browser-race'))

  const created = await run(
    Effect.gen(function* () {
      return yield* (yield* ListeningCommandService).createCollection({
        requestId: crypto.randomUUID(),
        title: 'Browser race',
      })
    }),
  )

  const browser = <A, E>(effect: Effect.Effect<A, E, Database>) =>
    Effect.runPromise(withTestLayer(effect, DatabaseTestLayer))

  const noteInput = {
    requestId: crypto.randomUUID(),
    mixId: saved.mixId,
    expectedVersion: saved.version,
    notes: 'MCP winner',
  }

  const browserEdit = {
    expectedVersion: saved.version,
    title: 'Browser title',
    notes: 'Browser notes',
    status: 'listening' as const,
    published: false,
  }

  const [mcp, form] = await Promise.all([
    run(
      Effect.gen(function* () {
        return yield* (yield* ListeningCommandService).updateListeningNotes(noteInput)
      }).pipe(Effect.result),
    ),
    browser(editListeningMix(owner, saved.mixId, browserEdit).pipe(Effect.result)),
  ])

  expect(Result.isSuccess(mcp)).not.toBe(Result.isSuccess(form))
  const [row] = await db.select().from(mixes).where(eq(mixes.id, saved.mixId))
  expect(row?.revision).toBe(2)
  expect(row?.notes).toBe(Result.isSuccess(mcp) ? 'MCP winner' : 'Browser notes')

  await browser(
    editListeningMix(owner, saved.mixId, {
      ...browserEdit,
      expectedVersion: 'revision:2',
      published: true,
    }),
  )
  expect(
    (
      await denied(
        Effect.gen(function* () {
          return yield* (yield* ListeningCommandService).updateListeningNotes({
            ...noteInput,
            requestId: crypto.randomUUID(),
            expectedVersion: 'revision:3',
          })
        }),
      )
    ).code,
  ).toBe('conflict')
  expect(await run(save('https://soundcloud.com/l1-command/browser-race'))).toEqual({
    mixId: saved.mixId,
    version: 'revision:3',
  })
  expect((await db.select().from(mixes).where(eq(mixes.id, saved.mixId)))[0]).toMatchObject({
    notes: 'Browser notes',
    published: true,
    revision: 3,
  })

  await browser(
    setListeningMembership(owner, created.collectionId, saved.mixId, true, created.version),
  )
  await browser(
    writeListeningCollection(
      owner,
      {
        title: 'Browser metadata',
        description: '',
        published: false,
        expectedVersion: 'revision:2',
      },
      created.collectionId,
    ),
  )
  expect(
    (
      await denied(
        Effect.gen(function* () {
          return yield* (yield* ListeningCommandService).updateCollection({
            requestId: crypto.randomUUID(),
            collectionId: created.collectionId,
            expectedVersion: 'revision:2',
            title: 'Stale MCP',
          })
        }),
      )
    ).code,
  ).toBe('conflict')
  await browser(deleteListeningItem(owner, saved.mixId, 'mix', 'revision:3'))
  expect(
    await db.select().from(memberships).where(eq(memberships.collectionId, created.collectionId)),
  ).toEqual([])
  expect(
    (await db.select().from(collections).where(eq(collections.id, created.collectionId)))[0],
  ).toMatchObject({ title: 'Browser metadata', revision: 4, lastOperationId: null })
  expect(
    (
      await browser(
        writeListeningCollection(
          owner,
          {
            title: 'Stale browser',
            description: '',
            published: false,
            expectedVersion: 'revision:3',
          },
          created.collectionId,
        ).pipe(Effect.flip),
      )
    ).reason,
  ).toBe('conflict')
}, 30_000)
