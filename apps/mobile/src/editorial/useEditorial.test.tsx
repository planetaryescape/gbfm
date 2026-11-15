import { Effect } from 'effect'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'test-renderer'
import { expect, test } from 'vitest'

import { EditorialMissing, EditorialUnavailable, type readEditorial } from '@/api/editorialReader'

import { useEditorial, type EditorialState } from './useEditorial'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test('slug changes and unmount interrupt pending editorial loads without stale state or rejection', async () => {
  const requests: Array<{
    slug: string
    signal: AbortSignal
    finish: () => void
  }> = []

  const states: Array<EditorialState> = []

  const read: typeof readEditorial = (slug) =>
    Effect.promise(
      (signal) => new Promise<void>((finish) => requests.push({ slug, signal, finish })),
    ).pipe(Effect.andThen(Effect.fail(new EditorialMissing())))

  function Reader({ slug }: { readonly slug: string }) {
    const state = useEditorial(slug, read)
    useEffect(() => {
      states.push(state)
    })

    return null
  }

  const mounted = createRoot()
  await act(async () => mounted.render(createElement(Reader, { slug: 'first' })))
  expect(states.at(-1)).toEqual({ status: 'loading' })
  await act(async () => requests[0]?.finish())
  expect(states.at(-1)).toEqual({ status: 'missing' })

  const before = states.length
  await act(async () => mounted.render(createElement(Reader, { slug: 'second' })))
  expect(states.slice(before).every((state) => state.status === 'loading')).toBe(true)
  await act(async () => mounted.render(createElement(Reader, { slug: 'first' })))
  expect(states.at(-1)).toEqual({ status: 'loading' })
  expect(requests[1]?.signal.aborted).toBe(true)
  await act(async () => requests[1]?.finish())
  expect(states.at(-1)).toEqual({ status: 'loading' })
  await act(async () => mounted.unmount())
  expect(requests[2]?.signal.aborted).toBe(true)
  const count = states.length
  await act(async () => requests[2]?.finish())
  expect(states).toHaveLength(count)
})

test.each([
  { name: 'missing', work: Effect.fail(new EditorialMissing()), status: 'missing' },
  { name: 'unavailable', work: Effect.fail(new EditorialUnavailable()), status: 'unavailable' },
  { name: 'defect', work: Effect.die('fixture defect'), status: 'unavailable' },
])('handles $name editorial exits', async ({ work, status }) => {
  let current: EditorialState | undefined
  const read: typeof readEditorial = () => work

  function Reader() {
    const state = useEditorial('fixture', read)
    useEffect(() => {
      current = state
    })

    return null
  }

  const mounted = createRoot()
  await act(async () => mounted.render(createElement(Reader)))
  expect(current).toEqual({ status })
  await act(async () => mounted.unmount())
})
