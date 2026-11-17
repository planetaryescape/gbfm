import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Schema } from 'effect'
import { expect, test } from 'vitest'

test('Hermes composition retains the original Metro debug ID without an authenticated upload', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gbfm-hermes-debug-id-'))
  const debugId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const packager = join(directory, 'packager.map')
  const compiler = join(directory, 'compiler.map')
  const composed = join(directory, 'composed.map')

  try {
    writeFileSync(
      packager,
      JSON.stringify({
        version: 3,
        sources: ['source.ts'],
        names: [],
        mappings: 'AAAA',
        sourcesContent: ['export const value = 1'],
        debug_id: debugId,
      }),
    )
    writeFileSync(
      compiler,
      JSON.stringify({
        version: 3,
        sources: ['main.jsbundle'],
        names: [],
        mappings: 'AAAA',
      }),
    )
    execFileSync(process.execPath, [
      resolve(import.meta.dirname, '../../scripts/compose-hermes-map.cjs'),
      packager,
      compiler,
      '-o',
      composed,
    ])

    const result = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          debug_id: Schema.String,
          debugId: Schema.String,
          sources: Schema.Array(Schema.String),
        }),
      ),
    )(readFileSync(composed, 'utf8'))

    expect(result.debug_id).toBe(debugId)
    expect(result.debugId).toBe(debugId)
    expect(result.sources).toEqual(['source.ts'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
