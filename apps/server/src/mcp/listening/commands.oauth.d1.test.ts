import { eq, sql } from 'drizzle-orm'
import { Effect, Layer, Schema } from 'effect'
import { expect, test } from 'vitest'

import { Database } from '@/db/layer'
import {
  listeningCollectionsTable as collections,
  savedMixesTable as mixes,
  listeningMembershipsTable as memberships,
} from '@/db/listening.schema'
import { oauthAccessToken, oauthResource } from '@/db/oauth.schema'
import { ConfigService } from '@/services/config.service'
import { EditorialOAuth } from '@/services/editorial-oauth.service'
import { createEditorialOAuthFixture, OAuthTokens } from '@/test/editorial-oauth'
import { withTestLayer } from '@/test/effect'

import { CommandAuthority, makeOAuthCommandAuthority } from '../command-authority'
import { McpOperationStoreLayer } from '../operations/store'
import { ListeningCommandService, ListeningCommandServiceLive } from './commands'

test('persisted listener OAuth authority fences every command and rechecks original-result disclosure', async () => {
  await using fixture = await createEditorialOAuthFixture()
  const scopes = 'listening:read listening:write offline_access'
  const clientId = await fixture.register(scopes)
  // Enable only this disposable fixture's policy; production scope policy is unchanged.
  await fixture.db.update(oauthResource).set({ allowedScopes: JSON.stringify(scopes.split(' ')) })

  const tokens = Schema.decodeUnknownSync(OAuthTokens)(
    await (
      await fixture.exchange(clientId, await fixture.authorize(clientId, 'reader', scopes))
    ).json(),
  )

  const principal = await Effect.runPromise(fixture.service.verify(tokens.access_token))

  const authority = await Effect.runPromise(
    makeOAuthCommandAuthority(tokens.access_token, principal).pipe(
      Effect.provideService(Database, fixture.db),
      Effect.provideService(ConfigService, fixture.config),
      Effect.provideService(EditorialOAuth, fixture.service),
    ),
  )

  const layer = ListeningCommandServiceLive.pipe(
    Layer.provide(Layer.succeed(Database, fixture.db)),
    Layer.provide(McpOperationStoreLayer(fixture.database)),
  )

  const run = <A, E>(
    program: Effect.Effect<A, E, ListeningCommandService | CommandAuthority>,
    credential = authority,
  ) =>
    Effect.runPromise(
      withTestLayer(program.pipe(Effect.provideService(CommandAuthority, credential)), layer),
    )

  const saveInput = {
    requestId: crypto.randomUUID(),
    url: 'https://soundcloud.com/oauth-listener/guard',
    title: 'Private',
  }

  const createInput = { requestId: crypto.randomUUID(), title: 'Private collection' }

  const saved = await run(
    Effect.gen(function* () {
      return yield* (yield* ListeningCommandService).saveMix(saveInput)
    }),
  )

  const created = await run(
    Effect.gen(function* () {
      return yield* (yield* ListeningCommandService).createCollection(createInput)
    }),
  )

  expect(
    await run(
      Effect.gen(function* () {
        return yield* (yield* ListeningCommandService).createCollection(createInput)
      }),
    ),
  ).toEqual(created)
  expect(principal.userId).toBe('reader')

  const checkpoint = await Effect.runPromise(
    authority.checkpoint(['listening:read', 'listening:write']),
  )

  const before = await fixture.db.get(sql`select count(*) as receipts from mcp_operations`)
  await fixture.db.update(oauthAccessToken).set({ scopes: JSON.stringify(['listening:write']) })

  const replay = Effect.gen(function* () {
    return yield* (yield* ListeningCommandService).createCollection(createInput)
  })

  expect((await run(replay.pipe(Effect.flip))).code).toBe('access_denied')

  // Deliberately hold a previously valid checkpoint: only the live SQL predicate can reject these plans.
  const stale = CommandAuthority.of({ checkpoint: () => Effect.succeed(checkpoint) })

  const plans = Effect.gen(function* () {
    const commands = yield* ListeningCommandService

    return [
      commands.saveMix({ ...saveInput, requestId: crypto.randomUUID() }).pipe(Effect.asVoid),
      commands
        .createCollection({ requestId: crypto.randomUUID(), title: 'Cannot create' })
        .pipe(Effect.asVoid),
      commands
        .updateListeningNotes({
          requestId: crypto.randomUUID(),
          mixId: saved.mixId,
          expectedVersion: saved.version,
          notes: 'Cannot change',
        })
        .pipe(Effect.asVoid),
      commands
        .setListeningStatus({
          requestId: crypto.randomUUID(),
          mixId: saved.mixId,
          expectedVersion: saved.version,
          status: 'listened',
        })
        .pipe(Effect.asVoid),
      commands
        .updateCollection({
          requestId: crypto.randomUUID(),
          collectionId: created.collectionId,
          expectedVersion: created.version,
          description: 'Cannot change',
        })
        .pipe(Effect.asVoid),
      commands
        .setCollectionMembership({
          requestId: crypto.randomUUID(),
          collectionId: created.collectionId,
          mixId: saved.mixId,
          expectedVersion: created.version,
          included: true,
        })
        .pipe(Effect.asVoid),
    ]
  })

  for (const plan of await run(plans))
    expect((await run(plan.pipe(Effect.flip), stale)).code).toBe('conflict')
  expect(await fixture.db.get(sql`select count(*) as receipts from mcp_operations`)).toEqual(before)
  expect((await fixture.db.select().from(mixes).where(eq(mixes.id, saved.mixId)))[0]).toMatchObject(
    { notes: '', status: 'to-listen', published: false, revision: 1 },
  )
  expect(
    (
      await fixture.db.select().from(collections).where(eq(collections.id, created.collectionId))
    )[0],
  ).toMatchObject({ title: createInput.title, description: '', published: false, revision: 1 })
  expect(await fixture.db.select().from(memberships)).toEqual([])

  await fixture.db.update(oauthAccessToken).set({ scopes: JSON.stringify(principal.scopes) })
  expect(await run(replay)).toEqual(created)
  await fixture.db.update(oauthAccessToken).set({ revoked: new Date() })
  expect((await run(replay.pipe(Effect.flip))).code).toBe('access_denied')
}, 30_000)
