import { Router } from '@effect/ui'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Predicate } from 'effect'
import { describe, expect, it } from 'vitest'

import { CreatorPageMessage } from '../features/creator/state'
import { parsePersistedUpload } from '../features/creator/upload/protocol'
import { RoutedApplicationNoDeps } from './routed-application'
import { documents, fieldValue, input, routedLayer } from './routed-feature-lifetime.test-support'
import { pumpReaderUntil, runReaderLifetime } from './routed-reader-lifetime.test-support'

describe('retirement: actual Root upload departure and recovery', () => {
  it.each(['/mixes', '/tweets'])(
    'suspends upload before %s departure and preserves recoverable bytes',
    async (destination) => {
      const bytes = new Map<string, string>()

      const storage: Storage = {
        get length() {
          return bytes.size
        },
        clear: () => bytes.clear(),
        key: (index) => [...bytes.keys()][index] ?? null,
        getItem: (key) => bytes.get(key) ?? null,
        setItem: (key, value) => {
          bytes.set(key, value)
        },
        removeItem: (key) => {
          bytes.delete(key)
        },
      }

      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
      const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { localStorage: storage },
      })
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
      const fixture = documents('/new/mix')
      const part = Promise.withResolvers<Response>()
      const events: Array<string> = []
      const requests: Array<string> = []

      const fetch: typeof globalThis.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input, fixture.props.url)
        requests.push(url.pathname)

        if (url.pathname.endsWith('/init'))
          return Response.json({
            uploadId: 'retirement-upload',
            key: 'audio/retirement.mp3',
            chunkSize: 3,
          })

        if (url.pathname.endsWith('/presign-part'))
          return Response.json({
            url: 'https://upload.test/part-1',
            partNumber: 1,
            expiresInSeconds: 300,
          })

        if (url.origin === 'https://upload.test') {
          events.push('part-started')
          init?.signal?.addEventListener(
            'abort',
            () => {
              events.push('upload-suspended')
            },
            { once: true },
          )

          return part.promise
        }

        if (url.pathname.includes('/legacy-recovery')) return Response.json(null)

        return new Response(null, { status: 404 })
      }

      try {
        await runReaderLifetime(
          { layer: routedLayer(fixture, fetch) },
          Effect.gen(function* () {
            const router = yield* Router.Router
            const root = yield* TestHost.mount(RoutedApplicationNoDeps, fixture.props)
            yield* TestHost.settle
            input(root, 'title', 'Recoverable retirement draft')
            yield* TestHost.settle
            const title = root.get(Locator.attr('name', 'title'))

            if (!Predicate.isTagged(title, 'Element') || !title.dispatch)
              throw new Error('Missing actual Creator draft actor')
            title.dispatch(
              'retirement-persist',
              () => CreatorPageMessage.RequestedAutosave(),
              undefined,
            )
            yield* TestHost.settle
            const draftBefore = [...bytes].filter(([key]) => key.startsWith('gbfm:creator:'))
            expect(
              draftBefore.some(([, value]) => value.includes('Recoverable retirement draft')),
            ).toBe(true)
            Locator.fire(root.get(Locator.attr('accept', 'audio/*')), 'change', {
              files: [
                new File(['abcdef'], 'retirement.mp3', { type: 'audio/mpeg', lastModified: 1 }),
              ],
            })
            yield* pumpReaderUntil(() => events.includes('part-started'))
            const checkpoint = [...bytes].find(([key]) => key.startsWith('gbfm:resumable-upload:'))
            expect(checkpoint).toBeDefined()
            expect(root.text()).toContain('Uploading')
            const held = fixture.holdNext()
            yield* router.navigate(destination)
            yield* pumpReaderUntil(() =>
              fixture.requests.some((request) => request.path === destination),
            )
            const beforeDestinationCommit = [...events]
            held.resume()
            yield* TestHost.settle
            part.resolve(new Response(null, { headers: { etag: 'part-1' } }))
            yield* TestHost.settle
            expect(beforeDestinationCommit).toContain('upload-suspended')
            expect(
              requests.some((path) => path.endsWith('/complete') || path.endsWith('/abort')),
            ).toBe(false)
            expect(checkpoint && bytes.get(checkpoint[0])).toBe(checkpoint?.[1])
            expect(checkpoint && parsePersistedUpload(JSON.parse(checkpoint[1]))?.uploadId).toBe(
              'retirement-upload',
            )

            for (const [key, value] of draftBefore) expect(bytes.get(key)).toBe(value)
            expect(root.model()?.pending).toBe(false)
            yield* router.navigate('/new/mix')
            yield* TestHost.settle
            const freshTitle = root.get(Locator.attr('name', 'title'))

            if (!Predicate.isTagged(freshTitle, 'Element') || !freshTitle.dispatch)
              throw new Error('Missing reentered Creator recovery actor')
            freshTitle.dispatch(
              'retirement-recover',
              () => CreatorPageMessage.RequestedRecovery(),
              undefined,
            )
            yield* TestHost.settle
            expect(fieldValue(root, 'title')).toBe('Recoverable retirement draft')
            expect(requests.filter((path) => path.endsWith('/init'))).toHaveLength(1)
          }),
        )
      } finally {
        part.resolve(new Response(null, { headers: { etag: 'part-1' } }))

        if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
        else Reflect.deleteProperty(globalThis, 'window')

        if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
        else Reflect.deleteProperty(globalThis, 'localStorage')
      }
    },
  )
})
