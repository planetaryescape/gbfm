import { createScrubberGesture, type ScrubberPreview } from '@gbfm/player'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native'

import { haptics } from '@/feedback/haptics'

type Options = {
  readonly currentTime: number
  readonly duration: number
  readonly onSeek: (seconds: number) => void
  readonly onPressChange: (pressed: number) => void
}

export function useHillScrubberGesture(options: Options) {
  const latest = useRef(options)

  useLayoutEffect(() => {
    latest.current = options
  }, [options])
  const layout = useRef({ width: 0, origin: 0, x: 0, referenceSeconds: 0 })
  const [width, setWidth] = useState(0)

  const [feedback, setFeedback] = useState<{
    readonly preview: ScrubberPreview
    readonly x: number
    readonly referenceSeconds: number
  } | null>(null)

  const controller = useRef<ReturnType<typeof createScrubberGesture> | null>(null)

  useLayoutEffect(() => {
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
      onCommit: (seconds) => {
        setFeedback(null)
        latest.current.onPressChange(0)
        latest.current.onSeek(seconds)
      },
      onCancel: () => {
        setFeedback(null)
        latest.current.onPressChange(0)
      },
      onFine: () => {
        void haptics.select()
      },
    })

    controller.current = gesture

    return () => {
      gesture.dispose()
      controller.current = null
    }
  }, [])
  const previousDuration = useRef(options.duration)

  useEffect(() => {
    if (previousDuration.current !== options.duration) {
      controller.current?.cancel()
      previousDuration.current = options.duration
    }
  }, [options.duration])

  return {
    feedback,
    width,
    onLayout: (event: LayoutChangeEvent) => {
      layout.current.width = event.nativeEvent.layout.width
      setWidth(layout.current.width)
    },
    start: (event: GestureResponderEvent) => {
      if (layout.current.width <= 0) return

      layout.current.origin = event.nativeEvent.pageX - event.nativeEvent.locationX
      layout.current.x = event.nativeEvent.locationX
      layout.current.referenceSeconds = latest.current.currentTime
      controller.current?.start({
        x: layout.current.x,
        y: event.nativeEvent.pageY,
        width: layout.current.width,
        currentTime: latest.current.currentTime,
        duration: latest.current.duration,
      })
      void haptics.select()
      latest.current.onPressChange(1)
    },
    move: (event: GestureResponderEvent) => {
      layout.current.x = event.nativeEvent.pageX - layout.current.origin
      controller.current?.move(layout.current.x, event.nativeEvent.pageY)
    },
    release: (event: GestureResponderEvent) => {
      layout.current.x = event.nativeEvent.pageX - layout.current.origin
      controller.current?.release(layout.current.x, event.nativeEvent.pageY)
    },
    cancel: () => controller.current?.cancel(),
  }
}
