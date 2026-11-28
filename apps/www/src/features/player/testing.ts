import { Effect, type Layer, ManagedRuntime, type Scope } from 'effect'

export const runWithLayer = async <A, E, R>(
  layer: Layer.Layer<R>,
  program: Effect.Effect<A, E, R | Scope.Scope>,
): Promise<A> => {
  const runtime = ManagedRuntime.make(layer)

  try {
    return await runtime.runPromise(Effect.scoped(program))
  } finally {
    await runtime.dispose()
  }
}
