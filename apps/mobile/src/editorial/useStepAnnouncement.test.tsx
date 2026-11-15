import { act, useEffect } from 'react'
import { createRoot } from 'test-renderer'
import { afterEach, expect, test, vi } from 'vitest'

import { useStepAnnouncement } from './useStepAnnouncement'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => vi.useRealTimers())

test('announces only the current focused step and cancels stale, blurred and unmounted announcements', async () => {
  vi.useFakeTimers()
  const spoken: Array<string> = []

  const announce = (label: string) => {
    spoken.push(label)
  }

  function FocusedReader({
    label,
    focused,
  }: {
    readonly label: string
    readonly focused: boolean
  }) {
    const focus = useStepAnnouncement(label, announce)
    useEffect(() => {
      if (focused) return focus()

      return undefined
    }, [focused, focus])

    return null
  }

  const root = createRoot()
  await act(async () => root.render(<FocusedReader label='Introduction' focused />))
  await act(async () => vi.runAllTimers())
  expect(spoken).toEqual(['Introduction'])
  await act(async () => root.render(<FocusedReader label='Chapter one' focused />))
  await act(async () => root.render(<FocusedReader label='Chapter two, entry one' focused />))
  await act(async () => vi.runAllTimers())
  expect(spoken).toEqual(['Introduction', 'Chapter two, entry one'])
  await act(async () => root.render(<FocusedReader label='Entry two' focused />))
  await act(async () => root.render(<FocusedReader label='Entry two' focused={false} />))
  await act(async () => vi.runAllTimers())
  expect(spoken).toHaveLength(2)
  await act(async () => root.render(<FocusedReader label='Entry two' focused />))
  await act(async () => vi.runAllTimers())
  expect(spoken.at(-1)).toBe('Entry two')
  await act(async () => root.render(<FocusedReader label='End of article' focused />))
  await act(async () => root.unmount())
  await act(async () => vi.runAllTimers())
  expect(spoken).not.toContain('End of article')
})
