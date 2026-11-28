import { join } from 'node:path'

import * as Cloudflare from '@alchemy.run/cloudflare'
import { AlchemyContext } from 'alchemy/AlchemyContext'
import type { StackServices } from 'alchemy/Stack'
import { Stage } from 'alchemy/Stage'
import { localState } from 'alchemy/State/LocalState'
import type { State } from 'alchemy/State/State'
import { Effect, FileSystem, Layer } from 'effect'

export const localDevState = Layer.unwrap(
  Effect.gen(function* () {
    const context = yield* AlchemyContext

    const stage = yield* Stage

    if (stage !== 'dev')
      return yield* Effect.die(new Error('Local development requires --stage=dev'))

    const fs = yield* FileSystem.FileSystem
    const directory = join(context.dotAlchemy, 'local-state')
    yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 }).pipe(Effect.orDie)
    yield* fs.chmod(directory, 0o700).pipe(Effect.orDie)

    return localState().pipe(
      Layer.provide(
        Layer.succeed(AlchemyContext, {
          ...context,
          dotAlchemy: directory,
        }),
      ),
    )
  }),
)

export const stackState = Layer.unwrap<State, never, StackServices, never, AlchemyContext>(
  Effect.gen(function* () {
    const context = yield* AlchemyContext

    return context.dev ? localDevState : Cloudflare.state()
  }),
)
