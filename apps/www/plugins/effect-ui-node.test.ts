import { once } from 'node:events'
import { createServer } from 'node:http'

import { Predicate } from 'effect'
import { expect, test } from 'vitest'

import { toWebRequest, writeWebResponse } from './effect-ui-node'

const withServer = async (
  handle: (request: Request) => Promise<Response>,
  verify: (origin: string) => Promise<void>,
) => {
  const server = createServer((incoming, outgoing) => {
    const abort = new AbortController()

    const cancel = () => {
      if (!outgoing.writableFinished) abort.abort()
    }

    incoming.once('aborted', cancel)
    outgoing.once('close', cancel)
    void (async () => {
      try {
        const request = toWebRequest(
          new URL(incoming.url ?? '/', 'http://fixture.test'),
          incoming,
          abort.signal,
        )

        await writeWebResponse(await handle(request), outgoing)
      } catch {
        outgoing.destroy()
      } finally {
        incoming.off('aborted', cancel)
        outgoing.off('close', cancel)
      }
    })()
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()

  if (!address || Predicate.isString(address)) throw new Error('Expected a TCP fixture address')

  try {
    await verify(`http://127.0.0.1:${address.port}`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

test('the Node adapter preserves streaming request bodies and separate response cookies', async () => {
  await withServer(
    async (request) => {
      const headers = new Headers({ 'content-type': request.headers.get('content-type') ?? '' })

      headers.append('set-cookie', 'first=1; HttpOnly')
      headers.append('set-cookie', 'second=2; HttpOnly')

      return new Response(request.body, { status: 201, statusText: 'Fixture Created', headers })
    },
    async (origin) => {
      const response = await fetch(`${origin}/actions/native`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'body=streamed%20form',
      })

      expect(response.status).toBe(201)
      expect(response.statusText).toBe('Fixture Created')
      expect(response.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
      expect(response.headers.getSetCookie()).toEqual(['first=1; HttpOnly', 'second=2; HttpOnly'])
      expect(await response.text()).toBe('body=streamed%20form')
    },
  )
})

test('disconnecting a Node client cancels the response stream and request scope', async () => {
  const cancelled = Promise.withResolvers<void>()
  const aborted = Promise.withResolvers<void>()

  await withServer(
    async (request) => {
      request.signal.addEventListener('abort', () => aborted.resolve(), { once: true })

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('first'))
          },
          cancel() {
            cancelled.resolve()
          },
        }),
      )
    },
    async (origin) => {
      const abort = new AbortController()
      const response = await fetch(origin, { signal: abort.signal })
      const reader = response.body?.getReader()

      if (!reader) throw new Error('Missing streamed response')

      expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
      abort.abort()
      await Promise.all([cancelled.promise, aborted.promise])
      reader.releaseLock()
    },
  )
})
