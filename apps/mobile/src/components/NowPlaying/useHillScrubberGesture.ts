import { createScrubberGesture, type ScrubberPreview } from '@gbfm/player'
import { useLayoutEffect, useRef, useState } from 'react'
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native'

type Options = {
  readonly currentTime: number
  readonly duration: number
  readonly onSeek: (seconds: number) => Promise<void>
  readonly onSeekError: (cause: unknown) => void
  readonly onPressChange: (pressed: number) => void
  readonly onHaptic: () => void
}

type Pointer = {
  readonly nativeEvent: Pick<GestureResponderEvent['nativeEvent'], 'pageX' | 'pageY' | 'locationX'>
}

export function useHillScrubberGesture(options: Options) {
  const latest = useRef(options)

  useLayoutEffect(() => {
    latest.current = options
  }, [options])
  const layout = useRef({ width: 0, origin: 0, x: 0, referenceSeconds: 0 })
  const [width, setWidth] = useState(0)
  const [committedSeconds, setCommittedSeconds] = useState<number | null>(null)
  const commitGeneration = useRef(0)

  const [feedback, setFeedback] = useState<{
    readonly preview: ScrubberPreview
    readonly x: number
    readonly referenceSeconds: number
  } | null>(null)

  const controller = useRef<ReturnType<typeof createScrubberGesture> | null>(null)
  const commit = useRef<((seconds: number) => void) | null>(null)

  useLayoutEffect(() => {
    let mounted = true
    const releasePress = () => latest.current.onPressChange(0)

    const seek = (seconds: number) => {
      setFeedback(null)
      setCommittedSeconds(seconds)
      const generation = ++commitGeneration.current
      latest.current.onPressChange(0)

      const settled = () => {
        if (mounted && generation === commitGeneration.current) setCommittedSeconds(null)
      }

      latest.current.onSeek(seconds).then(settled, (cause: unknown) => {
        settled()
        latest.current.onSeekError(cause)
      })
    }

    commit.current = seek

    const gesture = createScrubberGesture({
      scheduleHold: (callback, delay) => {
        const timer = setTimeout(callback, delay)

        return () => clearTimeout(timer)
      },
      onPreview: (preview) => {
        setFeedback({
          preview,
          x: layout.current.x,
          referenceSeconds: layout.current.referenceSeconds,
        })
      },
      onCommit: seek,
      onCancel: () => {
        setFeedback(null)
        latest.current.onPressChange(0)
      },
      onFine: () => {
        latest.current.onHaptic()
      },
    })

    controller.current = gesture

    return () => {
      gesture.dispose()
      mounted = false
      controller.current = null
      commit.current = null
      releasePress()
    }
  }, [])
  const previousDuration = useRef(options.duration)

  useLayoutEffect(() => {
    if (previousDuration.current !== options.duration) {
      controller.current?.cancel()
      commitGeneration.current++
      setCommittedSeconds(null)
      previousDuration.current = options.duration
    }
  }, [options.duration])

  const position = feedback?.preview.seconds ?? committedSeconds ?? options.currentTime

  return {
    feedback,
    position,
    adjustBy: (increment: number) => {
      if (!Number.isFinite(options.duration) || options.duration <= 0) return
      const seconds = Math.max(0, Math.min(options.duration, position + increment))
      controller.current?.cancel()
      commit.current?.(seconds)
      latest.current.onHaptic()
    },
    width,
    onLayout: (event: {
      readonly nativeEvent: {
        readonly layout: Pick<LayoutChangeEvent['nativeEvent']['layout'], 'width'>
      }
    }) => {
      layout.current.width = event.nativeEvent.layout.width
      setWidth(layout.current.width)
    },
    start: (event: Pointer) => {
      if (
        !controller.current ||
        layout.current.width <= 0 ||
        !Number.isFinite(latest.current.duration) ||
        latest.current.duration <= 0
      )
        return

      layout.current.origin = event.nativeEvent.pageX - event.nativeEvent.locationX
      layout.current.x = event.nativeEvent.locationX
      commitGeneration.current++
      layout.current.referenceSeconds = committedSeconds ?? latest.current.currentTime
      setCommittedSeconds(null)
      controller.current?.start({
        x: layout.current.x,
        y: event.nativeEvent.pageY,
        width: layout.current.width,
        currentTime: layout.current.referenceSeconds,
        duration: latest.current.duration,
      })
      latest.current.onHaptic()
      latest.current.onPressChange(1)
    },
    move: (event: Pointer) => {
      layout.current.x = event.nativeEvent.pageX - layout.current.origin
      controller.current?.move(layout.current.x, event.nativeEvent.pageY)
    },
    release: (event: Pointer) => {
      layout.current.x = event.nativeEvent.pageX - layout.current.origin
      controller.current?.release(layout.current.x, event.nativeEvent.pageY)
    },
    cancel: () => {
      controller.current?.cancel()
      commitGeneration.current++
      setCommittedSeconds(null)
    },
  }
}
