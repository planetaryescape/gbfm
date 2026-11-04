import { Clock, Effect, Layer } from 'effect'

export const reminderClock = (initialTime = 2_000_000_000_000) => {
  let now = initialTime

  return {
    advance: (milliseconds = 300_001) => {
      now += milliseconds
    },
    now: () => now,
    layer: Layer.succeed(Clock.Clock, {
      currentTimeMillis: Effect.sync(() => now),
      currentTimeMillisUnsafe: () => now,
      currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
      currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
      monotonicTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
      monotonicTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
      sleep: () => Effect.void,
    }),
  }
}
