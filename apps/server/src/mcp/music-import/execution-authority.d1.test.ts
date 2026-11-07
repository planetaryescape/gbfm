import { McpPrincipal, McpResourceUrl } from '@gbfm/core/editorial-mcp'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Result, Schema } from 'effect'
import { beforeAll, expect, test } from 'vitest'

import { user } from '@/db/auth.schema'
import { Database } from '@/db/layer'
import { McpActor, McpAuthorizationLive } from '@/mcp/authorization'
import { McpToolError } from '@/mcp/contracts'
import { db } from '@/test/d1'
import { withTestLayer } from '@/test/effect'

import { MusicImportCommandsLayer } from './commands'
import {
  MusicImportExecutionAuthority,
  MusicImportExecutionAuthorityLayer,
  MusicImportLiveGrant,
} from './execution-authority'

const resource = Schema.decodeUnknownSync(McpResourceUrl)('https://api.example.test/mcp')

const principal = Schema.decodeUnknownSync(McpPrincipal)({
  userId: 'i1-execution-admin',
  clientId: 'i1-execution-client',
  scopes: ['catalogue:write', 'catalogue:import', 'providers:read', 'playlists:write'],
})

const command = {
  operation: 'import_music_url',
  input: {
    requestId: 'b17dc9ee-4ec1-4eaa-b8a3-08e26bcc934a',
    url: 'https://soundcloud.com/controlled/sets/controlled',
    expectedType: 'track',
    artworkDelivery: 'preserve',
  },
}

const authorization = McpAuthorizationLive.pipe(Layer.provide(Layer.succeed(Database, db)))

const commands = MusicImportCommandsLayer.pipe(Layer.provide(authorization))

const layer = (grant: Effect.Effect<McpPrincipal, McpToolError>) =>
  MusicImportExecutionAuthorityLayer.pipe(
    Layer.provide(commands),
    Layer.provide(authorization),
    Layer.provide(
      Layer.succeed(MusicImportLiveGrant, {
        reverify: (audience) =>
          audience === resource
            ? grant
            : Effect.fail(
                new McpToolError({ code: 'access_denied', message: 'MCP access denied.' }),
              ),
      }),
    ),
    Layer.provide(Layer.succeed(McpActor, principal)),
  )

beforeAll(async () => {
  await db.insert(user).values({
    id: principal.userId,
    name: 'Controlled admin',
    email: 'i1-execution@example.test',
    role: 'admin',
  })
})

test('execution checkpoints reverify the live grant and enforce reused playlist authority despite a track hint', async () => {
  const noPlaylist = {
    ...principal,
    scopes: principal.scopes.filter((scope) => scope !== 'playlists:write'),
  }

  const result = await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const authority = yield* MusicImportExecutionAuthority
        const admission = yield* authority.check(command, resource)
        const reuse = yield* authority.check(command, resource, 'playlist').pipe(Effect.result)

        return { admission, reuse }
      }).pipe(Effect.provideService(McpActor, principal)),
      layer(Effect.succeed(noPlaylist)),
    ),
  )

  expect(result.admission.typeAuthority).toBe('pending')
  expect(result.reuse).toMatchObject({ failure: { code: 'access_denied' } })
})

test('execution rejects revoked grants, changed audience, substituted identity and removed scopes', async () => {
  const revoked = Effect.fail(
    new McpToolError({ code: 'access_denied', message: 'MCP access denied.' }),
  )

  for (const grant of [
    revoked,
    Effect.succeed({
      ...principal,
      userId: Schema.decodeUnknownSync(McpPrincipal.fields.userId)('other'),
    }),
    Effect.succeed({
      ...principal,
      clientId: Schema.decodeUnknownSync(McpPrincipal.fields.clientId)('other'),
    }),
    Effect.succeed({
      ...principal,
      scopes: principal.scopes.filter((scope) => scope !== 'providers:read'),
    }),
  ]) {
    expect(
      await Effect.runPromise(
        withTestLayer(
          Effect.flatMap(MusicImportExecutionAuthority, (authority) =>
            authority.check(command, resource),
          ).pipe(Effect.provideService(McpActor, principal)),
          layer(grant),
        ).pipe(Effect.result),
      ),
    ).toMatchObject({ failure: { code: 'access_denied' } })
  }

  const otherAudience = Schema.decodeUnknownSync(McpResourceUrl)('https://other.example.test/mcp')
  expect(
    await Effect.runPromise(
      withTestLayer(
        Effect.flatMap(MusicImportExecutionAuthority, (authority) =>
          authority.check(command, otherAudience),
        ).pipe(Effect.provideService(McpActor, principal)),
        layer(Effect.succeed(principal)),
      ).pipe(Effect.result),
    ),
  ).toMatchObject({ failure: { code: 'access_denied' } })
})

test('one execution layer rechecks account state between admission and later write or replay checkpoints', async () => {
  let grantActive = true

  const result = await Effect.runPromise(
    withTestLayer(
      Effect.gen(function* () {
        const authority = yield* MusicImportExecutionAuthority
        yield* authority.check(command, resource)
        grantActive = false
        const revoked = yield* authority.check(command, resource).pipe(Effect.result)
        grantActive = true
        yield* Effect.promise(() =>
          db.update(user).set({ role: 'creator' }).where(eq(user.id, principal.userId)),
        )
        const demoted = yield* authority.check(command, resource).pipe(Effect.result)
        yield* Effect.promise(() =>
          db.update(user).set({ role: 'admin', banned: true }).where(eq(user.id, principal.userId)),
        )
        const banned = yield* authority.check(command, resource).pipe(Effect.result)
        yield* Effect.promise(() => db.delete(user).where(eq(user.id, principal.userId)))
        const deleted = yield* authority.check(command, resource).pipe(Effect.result)

        return { revoked, demoted, banned, deleted }
      }).pipe(Effect.provideService(McpActor, principal)),
      layer(
        Effect.suspend(() =>
          grantActive
            ? Effect.succeed(principal)
            : Effect.fail(
                new McpToolError({ code: 'access_denied', message: 'MCP access denied.' }),
              ),
        ),
      ),
    ),
  )

  for (const denied of [result.revoked, result.demoted, result.banned, result.deleted]) {
    expect(Result.isFailure(denied)).toBe(true)
    expect(denied).toMatchObject({ failure: { code: 'access_denied' } })
  }
})
