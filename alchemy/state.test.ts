import * as NodeServices from '@effect/platform-node/NodeServices'
import { AlchemyContext } from 'alchemy/AlchemyContext'
import { Stage } from 'alchemy/Stage'
import { State } from 'alchemy/State/State'
import { Context, Effect, FileSystem, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'

import { localDevState } from './state'

const localLayer = (directory: string, stage = 'dev') =>
  localDevState.pipe(
    Layer.provide([
      Layer.succeed(AlchemyContext, { dotAlchemy: directory, dev: true, adopt: false }),
      Layer.succeed(Stage, stage),
    ]),
  )

describe('local Alchemy state isolation', () => {
  it('reopens the pre-provider-split local state path without relocating its output', async () => {
    const runtime = ManagedRuntime.make(NodeServices.layer)

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'gbfm-state-upgrade-' })
          const stageDirectory = `${directory}/local-state/state/gbfm/dev`
          const outputFile = `${stageDirectory}/__stack_output__.json`
          yield* fs.makeDirectory(stageDirectory, { recursive: true })
          yield* fs.writeFileString(outputFile, '{"fixture":"before-provider-split"}')

          const context = yield* Layer.build(localLayer(directory))
          const state = yield* Context.get(context, State)

          expect(state.id).toBe('local')
          expect(yield* state.listStacks()).toEqual(['gbfm'])
          expect(yield* state.listStages('gbfm')).toEqual(['dev'])
          expect(yield* state.getOutput({ stack: 'gbfm', stage: 'dev' })).toEqual({
            fixture: 'before-provider-split',
          })
          expect(yield* fs.readFileString(outputFile)).toBe('{"fixture":"before-provider-split"}')
          expect(yield* fs.exists(`${directory}/state`)).toBe(false)
        }).pipe(Effect.scoped),
      )
    } finally {
      await runtime.dispose()
    }
  })

  it('persists local output separately and leaves existing deployment state untouched', async () => {
    const runtime = ManagedRuntime.make(NodeServices.layer)

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'gbfm-state-' })
          const deploymentDirectory = `${directory}/state/gbfm/prod`
          const deploymentFile = `${deploymentDirectory}/__stack_output__.json`
          yield* fs.makeDirectory(deploymentDirectory, { recursive: true })
          yield* fs.writeFileString(deploymentFile, '{"fixture":"production"}')

          const context = yield* Layer.build(localLayer(directory))
          const state = yield* Context.get(context, State)
          expect(state.id).toBe('local')
          expect(yield* state.getOutput({ stack: 'gbfm', stage: 'dev' })).toBeUndefined()
          yield* state.setOutput({ stack: 'gbfm', stage: 'dev', value: { fixture: 'local' } })

          const reopenedContext = yield* Layer.build(Layer.fresh(localLayer(directory)))
          const reopened = yield* Context.get(reopenedContext, State)
          expect(yield* reopened.getOutput({ stack: 'gbfm', stage: 'dev' })).toEqual({
            fixture: 'local',
          })
          expect(yield* fs.readFileString(deploymentFile)).toBe('{"fixture":"production"}')
          expect(
            yield* fs.exists(`${directory}/local-state/state/gbfm/dev/__stack_output__.json`),
          ).toBe(true)
          expect(yield* fs.exists(`${directory}/state/gbfm/dev`)).toBe(false)
          expect((yield* fs.stat(`${directory}/local-state`)).mode & 0o777).toBe(0o700)
        }).pipe(Effect.scoped),
      )
    } finally {
      await runtime.dispose()
    }
  })

  it.each(['prod', 'd1-staging'])('rejects local development for the %s stage', async (stage) => {
    const runtime = ManagedRuntime.make(NodeServices.layer)

    try {
      await expect(
        runtime.runPromise(Layer.build(localLayer('/unused', stage)).pipe(Effect.scoped)),
      ).rejects.toThrow('Local development requires --stage=dev')
    } finally {
      await runtime.dispose()
    }
  })
})
