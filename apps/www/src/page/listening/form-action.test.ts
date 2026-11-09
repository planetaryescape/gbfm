import { createServer } from 'node:http'

import { Schema } from 'effect'
import { expect, test } from 'vitest'

import { handleListeningAction } from './form-action'

test('forms forward only their observed versions, preserve conflicts, and never fetch a replacement version', async () => {
  const received: Array<{ method: string | undefined; path: string | undefined; body: unknown }> =
    []

  let status = 200

  const server = createServer(async (request, response) => {
    let body = ''

    for await (const chunk of request) body += chunk
    received.push({ method: request.method, path: request.url, body: JSON.parse(body) })
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end('{}')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address())
  const previous = process.env.VPS_PROXY_TARGET
  process.env.VPS_PROXY_TARGET = `http://127.0.0.1:${address.port}`

  const submit = (operation: string, fields: Record<string, string>) => {
    const form = new FormData()

    for (const [key, value] of Object.entries(fields)) form.set(key, value)

    return handleListeningAction(
      new Request(`https://fixture.test/actions/listening/${operation}`),
      form,
    )
  }

  try {
    expect(
      (
        await submit('edit-mix', {
          id: 'mix',
          title: 'Draft',
          notes: 'Unsaved notes',
          status: 'listening',
        })
      ).response.status,
    ).toBe(400)
    expect(received).toEqual([])

    const fields = {
      id: 'mix',
      title: 'Draft',
      notes: 'Unsaved notes',
      status: 'listening',
      expectedVersion: 'revision:7',
    }

    status = 409
    const conflict = await submit('edit-mix', fields)
    expect(conflict.response.status).toBe(409)
    expect(conflict.response.headers.get('cache-control')).toBe('private, no-store')
    expect(received).toEqual([
      {
        method: 'PUT',
        path: '/api/listening/mixes/mix',
        body: {
          expectedVersion: 'revision:7',
          title: 'Draft',
          notes: 'Unsaved notes',
          status: 'listening',
          published: false,
        },
      },
    ])
    status = 200
    expect(
      (
        await submit('membership', {
          id: 'collection',
          mixId: 'mix',
          expectedVersion: 'revision:19',
          included: 'false',
        })
      ).response.status,
    ).toBe(303)
    expect(
      (await submit('delete-mix', { id: 'mix', expectedVersion: 'revision:8' })).response.status,
    ).toBe(303)
    expect(
      (
        await submit('edit-collection', {
          id: 'collection',
          title: 'Renamed',
          description: '',
          expectedVersion: 'revision:20',
        })
      ).response.status,
    ).toBe(303)
    expect(
      (await submit('delete-collection', { id: 'collection', expectedVersion: 'revision:21' }))
        .response.status,
    ).toBe(303)
    expect(received.slice(1)).toEqual([
      {
        method: 'PUT',
        path: '/api/listening/collections/collection/mixes/mix',
        body: { expectedVersion: 'revision:19', included: false },
      },
      {
        method: 'DELETE',
        path: '/api/listening/mixes/mix',
        body: { expectedVersion: 'revision:8' },
      },
      {
        method: 'PUT',
        path: '/api/listening/collections/collection',
        body: {
          title: 'Renamed',
          description: '',
          published: false,
          expectedVersion: 'revision:20',
        },
      },
      {
        method: 'DELETE',
        path: '/api/listening/collections/collection',
        body: { expectedVersion: 'revision:21' },
      },
    ])
  } finally {
    if (previous === undefined) delete process.env.VPS_PROXY_TARGET
    else process.env.VPS_PROXY_TARGET = previous
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
