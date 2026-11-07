import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Data } from 'effect'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { NavigationLockDecisionDto } from './navigation-lock.do'

const Decision = Data.taggedEnum<NavigationLockDecisionDto>()

let runtime: Miniflare

let directory: string

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gbfm-navigation-lock-'))
  const scriptPath = join(directory, 'worker.mjs')
  execFileSync('bun', [
    'build',
    'src/test/navigation-lock-worker.ts',
    '--target=browser',
    '--external=cloudflare:workers',
    '--outfile',
    scriptPath,
  ])
  runtime = new Miniflare({
    name: 'navigation-lock-test',
    scriptPath,
    modulesRoot: directory,
    modules: true,
    compatibilityDate: '2026-07-04',
    durableObjects: { LOCK: { className: 'NavigationLockDurableObject', useSQLite: true } },
  })
})

afterAll(async () => {
  await runtime?.dispose()

  if (directory) await rm(directory, { recursive: true, force: true })
})

test('SQLite DO RPC preserves reserve, duplicate, retry, sync and reset decisions', async () => {
  const response = await runtime.dispatchFetch('https://lock.example.test/lifecycle')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    retainedIdentity: true,
    first: Decision.Proceed({ sessionId: null, position: 0 }),
    reserved: Decision.Retry(),
    duplicate: Decision.Duplicate({ sessionId: 'session' }),
    stale: Decision.Retry(),
    next: Decision.Proceed({ sessionId: 'session', position: 1 }),
    synced: Decision.Duplicate({ sessionId: 'session' }),
    heartbeat: { canonicalName: 'reader', hasSession: false },
    reset: Decision.Proceed({ sessionId: null, position: 0 }),
  })
})

test('an abandoned reservation still consumes a position when the caller supplies its cursor', async () => {
  const response = await runtime.dispatchFetch('https://lock.example.test/abandoned')
  expect(await response.json()).toEqual({
    reserved: Decision.Proceed({ sessionId: null, position: 0 }),
    next: Decision.Proceed({ sessionId: null, position: 1 }),
  })
})

test('late commits cannot resurrect reset state or overwrite newer sync state', async () => {
  const response = await runtime.dispatchFetch('https://lock.example.test/late')
  expect(await response.json()).toEqual({
    afterReset: { canonicalName: null, hasSession: false },
    newer: Decision.Duplicate({ sessionId: 'session' }),
  })
})

test('only the current reservation can commit, including after reset and cursor reuse', async () => {
  const response = await runtime.dispatchFetch('https://lock.example.test/ownership')
  expect(await response.json()).toEqual({
    pending: Decision.Retry(),
    wrongOwner: Decision.Retry(),
    stale: Decision.Retry(),
    committed: Decision.Duplicate({ sessionId: 'replacement-session' }),
    replay: Decision.Duplicate({ sessionId: 'replacement-session' }),
  })
})

test('a superseded reservation cannot commit over a newer pending reservation', async () => {
  const response = await runtime.dispatchFetch('https://lock.example.test/superseded')
  expect(await response.json()).toEqual({
    next: Decision.Proceed({ sessionId: null, position: 1 }),
    stale: Decision.Retry(),
    current: Decision.Duplicate({ sessionId: 'session' }),
  })
})

test('reservation ownership and reset fencing survive object eviction', async () => {
  const request = (action: string) =>
    runtime.dispatchFetch(`https://lock.example.test/persistent?action=${action}`)

  const evict = () =>
    runtime.unsafeEvictDurableObject('navigation-lock-test', 'NavigationLockDurableObject', {
      name: '/persistent',
    })

  expect(await (await request('reserve')).json()).toEqual(
    Decision.Proceed({ sessionId: null, position: 0 }),
  )
  await evict()
  expect(await (await request('commit')).json()).toEqual(
    Decision.Duplicate({ sessionId: 'session' }),
  )
  expect(await (await request('reset')).json()).toEqual({ canonicalName: null, hasSession: false })
  await evict()
  expect(await (await request('commit')).json()).toEqual(
    Decision.Proceed({ sessionId: null, position: 1 }),
  )
})
