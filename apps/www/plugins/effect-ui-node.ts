import type { IncomingMessage, ServerResponse } from 'node:http'

import { Predicate } from 'effect'

export const toWebRequest = (url: URL, incoming: IncomingMessage, signal: AbortSignal): Request => {
  const headers = new Headers()

  for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
    const name = incoming.rawHeaders[index]
    const value = incoming.rawHeaders[index + 1]

    if (name !== undefined && value !== undefined) headers.append(name, value)
  }

  const method = incoming.method ?? 'GET'

  if (method === 'GET' || method === 'HEAD') return new Request(url, { method, headers, signal })
  const iterator = incoming[Symbol.asyncIterator]()

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next()

      if (next.done) return controller.close()
      const chunk: unknown = next.value

      if (Predicate.isString(chunk)) controller.enqueue(new TextEncoder().encode(chunk))
      else if (chunk instanceof Uint8Array) controller.enqueue(chunk)
      else controller.error(new TypeError('Unsupported HTTP request body chunk'))
    },
    async cancel() {
      await iterator.return?.()
    },
  })

  const init = { method, headers, signal, body, duplex: 'half' }

  return new Request(url, init)
}

export const writeWebResponse = async (
  response: Response,
  outgoing: ServerResponse,
): Promise<void> => {
  outgoing.statusCode = response.status

  if (response.statusText) outgoing.statusMessage = response.statusText
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') outgoing.setHeader(name, value)
  })
  const cookies = response.headers.getSetCookie()

  if (cookies.length) outgoing.setHeader('set-cookie', cookies)

  if (!response.body) {
    outgoing.end()

    return
  }

  const reader = response.body.getReader()

  const cancel = () => {
    void reader.cancel().catch(() => undefined)
  }

  outgoing.once('close', cancel)

  try {
    while (!outgoing.destroyed) {
      const chunk = await reader.read()

      if (chunk.done) break
      await new Promise<void>((resolve, reject) => {
        outgoing.write(chunk.value, (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }

    if (!outgoing.destroyed) outgoing.end()
  } finally {
    outgoing.off('close', cancel)
    reader.releaseLock()
  }
}
