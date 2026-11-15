import { act, createElement } from 'react'
import { createRoot } from 'test-renderer'
import { expect, test } from 'vitest'

import { pauseExternalAudio } from '@/audio/pauseExternalAudio'

import { useVideoSession } from './useVideoSession'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test('video waits for the app pause and close never resumes or otherwise changes playback', async () => {
  let finish: (paused: boolean) => void = () => {
    throw new Error('Pause not requested')
  }

  const commands: Array<string> = []

  const pause = () => {
    commands.push('pause')

    return new Promise<boolean>((resolve) => {
      finish = resolve
    })
  }

  function Video() {
    const session = useVideoSession(pause)

    return createElement('video', { ...session })
  }

  const root = createRoot()
  await act(async () => root.render(<Video />))

  const video = () => {
    const node = root.container.queryAll((node) => node.type === 'video')[0]

    if (!node) throw new Error('Video not mounted')

    return node
  }

  let pending: Promise<void> | undefined
  await act(async () => {
    pending = video().props.open()
  })
  expect(commands).toEqual(['pause'])
  expect(video().props.visible).toBe(false)
  await act(async () => {
    finish(true)
    await pending
  })
  expect(video().props.visible).toBe(true)
  commands.push('user plays a different queue item')
  await act(async () => video().props.close())
  expect(video().props.visible).toBe(false)
  expect(commands).toEqual(['pause', 'user plays a different queue item'])
  await act(async () => {
    pending = video().props.open()
  })
  await act(async () => video().props.close())
  await act(async () => {
    finish(true)
    await pending
  })
  expect(video().props.visible).toBe(false)
  await act(async () => {
    pending = video().props.open()
  })
  await act(async () => root.unmount())
  await act(async () => {
    finish(true)
    await pending
  })
})

test.each(['unavailable', 'rejected'])('does not autoplay when pause is %s', async (failure) => {
  function Video() {
    const session = useVideoSession(async () => {
      if (failure === 'rejected') throw new Error('Audio unavailable')

      return false
    })

    return createElement('video', { ...session })
  }

  const root = createRoot()
  await act(async () => root.render(<Video />))
  const node = root.container.queryAll((node) => node.type === 'video')[0]

  if (!node) throw new Error('Video not mounted')
  await act(async () => node.props.open())
  expect(node.props.visible).toBe(false)
  expect(node.props.failed).toBe(true)
  await act(async () => root.unmount())
})

test('a cold-start poster opens with no audio controller while close still cancels a pending open', async () => {
  const commands: Array<string> = []

  function Video() {
    const session = useVideoSession(() =>
      pauseExternalAudio(
        () => null,
        async () => {
          commands.push('pause')

          return false
        },
      ),
    )

    return createElement('video', { ...session })
  }

  const root = createRoot()
  await act(async () => root.render(<Video />))
  const node = root.container.queryAll((node) => node.type === 'video')[0]

  if (!node) throw new Error('Video not mounted')
  await act(async () => node.props.open())
  expect(node.props.visible).toBe(true)
  expect(node.props.failed).toBe(false)
  expect(commands).toEqual([])
  await act(async () => node.props.close())
  await act(async () => {
    const pending = node.props.open()
    node.props.close()
    await pending
  })
  expect(node.props.visible).toBe(false)
  expect(node.props.failed).toBe(false)
  await act(async () => root.unmount())
})
