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

test('late commits currently resurrect reset state and overwrite newer sync state', async () => {
  const response = await runtime.dispatchFetch('https://lock.example.test/late')
  expect(await response.json()).toEqual({
    resurrected: Decision.Duplicate({ sessionId: 'session' }),
    overwritten: Decision.Duplicate({ sessionId: 'session' }),
  })
})
