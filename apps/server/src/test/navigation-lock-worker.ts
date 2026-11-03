import { NavigationLockDurableObject } from '../durable-objects/navigation-lock.do'

export { NavigationLockDurableObject }

export default {
  async fetch(
    request: Request,
    env: { LOCK: DurableObjectNamespace<NavigationLockDurableObject> },
  ) {
    const path = new URL(request.url).pathname
    const lock = env.LOCK.getByName(path)
    const initial = { sessionId: null, cursor: null, updatedAtMs: null, intentToken: 'first' }
    const committed = { sessionId: 'session', position: 0, updatedAtMs: 100, intentToken: 'first' }

    if (path === '/lifecycle') {
      const identity = await lock.setIdentity('reader')
      const retained = await lock.setIdentity('different-reader')
      const first = await lock.decide(initial)
      const reserved = await lock.decide(initial)
      await lock.commit(committed)
      const duplicate = await lock.decide(initial)
      const stale = await lock.decide({ ...initial, intentToken: 'second' })

      const next = await lock.decide({
        sessionId: 'session',
        cursor: 0,
        updatedAtMs: 100,
        intentToken: 'second',
      })

      await lock.sync({ ...committed, position: 1, updatedAtMs: 200, intentToken: 'second' })
      const synced = await lock.decide({ ...initial, intentToken: 'second' })
      await lock.reset()
      const heartbeat = await lock.heartbeat()
      const reset = await lock.decide(initial)

      return Response.json({
        retainedIdentity: identity.canonicalName === retained.canonicalName,
        first,
        reserved,
        duplicate,
        stale,
        next,
        synced,
        heartbeat,
        reset,
      })
    }

    if (path === '/abandoned') {
      const reserved = await lock.decide(initial)
      const next = await lock.decide({ ...initial, cursor: 0, intentToken: 'second' })

      return Response.json({ reserved, next })
    }

    await lock.decide(initial)
    await lock.commit(committed)
    await lock.reset()
    await lock.commit({ ...committed, position: 7, intentToken: 'late' })
    const resurrected = await lock.decide({ ...initial, intentToken: 'late' })
    await lock.sync({ ...committed, position: 10, updatedAtMs: 200, intentToken: 'newer' })
    await lock.commit(committed)
    const overwritten = await lock.decide(initial)

    return Response.json({ resurrected, overwritten })
  },
}
