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

    if (path === '/ownership') {
      await lock.sync(committed)
      const request = { sessionId: 'session', cursor: 0, updatedAtMs: 100, intentToken: 'second' }
      await lock.decide(request)
      const pending = await lock.decide(request)
      await lock.commit({ ...committed, position: 1, intentToken: 'wrong-owner' })
      const wrongOwner = await lock.decide({ ...request, intentToken: 'wrong-owner' })
      await lock.reset()
      await lock.decide({ ...request, intentToken: 'replacement' })
      await lock.commit({ ...committed, position: 1, intentToken: 'second' })
      const stale = await lock.decide({ ...request, intentToken: 'second' })

      const replacement = {
        sessionId: 'replacement-session',
        position: 1,
        updatedAtMs: 200,
        intentToken: 'replacement',
      }

      await lock.commit(replacement)
      const committedResult = await lock.decide({ ...initial, intentToken: 'replacement' })
      await lock.commit({ ...replacement, sessionId: 'replayed-session', updatedAtMs: 300 })
      const replay = await lock.decide({ ...initial, intentToken: 'replacement' })

      return Response.json({ pending, wrongOwner, stale, committed: committedResult, replay })
    }

    if (path === '/superseded') {
      await lock.decide(initial)
      const nextRequest = { ...initial, cursor: 0, intentToken: 'second' }
      const next = await lock.decide(nextRequest)
      await lock.commit(committed)
      const stale = await lock.decide(initial)
      await lock.commit({ ...committed, position: 1, intentToken: 'second', updatedAtMs: 200 })
      const current = await lock.decide({ ...initial, intentToken: 'second' })

      return Response.json({ next, stale, current })
    }

    if (path === '/persistent') {
      const action = new URL(request.url).searchParams.get('action')

      if (action === 'reserve') return Response.json(await lock.decide(initial))

      if (action === 'reset') {
        await lock.reset()

        return Response.json(await lock.heartbeat())
      }

      await lock.commit(committed)

      return Response.json(await lock.decide({ ...initial, cursor: 0, intentToken: 'first' }))
    }

    await lock.decide(initial)
    await lock.commit(committed)
    await lock.reset()
    await lock.commit({ ...committed, position: 7, intentToken: 'late' })
    const afterReset = await lock.heartbeat()
    await lock.sync({ ...committed, position: 10, updatedAtMs: 200, intentToken: 'newer' })
    await lock.commit(committed)
    const newer = await lock.decide({ ...initial, intentToken: 'newer' })

    return Response.json({ afterReset, newer })
  },
}
