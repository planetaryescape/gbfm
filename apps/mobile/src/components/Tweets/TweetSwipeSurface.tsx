import {
  beginReaderSwipe,
  finishReaderSwipe,
  moveReaderSwipe,
  readerSwipeOffset,
  type ReaderSwipe,
} from '@gbfm/core/reader-swipe'
import { useFocusEffect } from 'expo-router'
import { type PropsWithChildren, useCallback, useEffect } from 'react'
import { useWindowDimensions, View } from 'react-native'
import {
  GestureDetector,
  GestureHandlerRootView,
  GestureStateManager,
  usePanGesture,
  useNativeGesture,
} from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { SwipeGestureContext } from './SwipeExclusion'
import { useReaderReducedMotion } from './useReaderMotion'

const spring = { damping: 28, stiffness: 280, mass: 0.8, overshootClamping: true }

export function TweetSwipeSurface({
  children,
  onSwipe,
  disabled,
  pending,
  newer,
  older,
  entering,
}: PropsWithChildren<{
  readonly onSwipe: (direction: 'older' | 'newer') => void
  readonly disabled: boolean
  readonly pending: boolean
  readonly newer: boolean
  readonly older: boolean
  readonly entering: 'older' | 'newer' | null
}>) {
  const { width } = useWindowDimensions()
  const reduced = useReaderReducedMotion()
  const swipe = useSharedValue<ReaderSwipe | null>(null)
  const offset = useSharedValue(!reduced && entering ? (entering === 'older' ? 48 : -48) : 0)
  const settling = useSharedValue(false)
  const enabled = useSharedValue(!disabled)

  const cancel = useCallback(() => {
    enabled.set(false)
    cancelAnimation(offset)
    offset.set(0)
    swipe.set(null)
    settling.set(false)
  }, [enabled, offset, swipe, settling])

  useFocusEffect(
    useCallback(() => {
      enabled.set(true)

      return cancel
    }, [cancel, enabled]),
  )

  useEffect(() => {
    enabled.set(!disabled)

    if (disabled && !pending) {
      swipe.set(null)
      settling.set(false)
      offset.set(reduced ? 0 : withSpring(0, spring))
    }
  }, [disabled, pending, reduced, enabled, swipe, settling, offset])

  useEffect(() => {
    if (entering && !reduced) offset.set(withSpring(0, spring))
  }, [entering, reduced, offset])

  const pan = usePanGesture({
    enabled: !disabled,
    activeOffsetX: [-12, 12],
    failOffsetY: [-12, 12],
    maxPointers: 1,
    onTouchesDown: (event) => {
      'worklet'

      if (!enabled.get() || settling.get()) {
        GestureStateManager.fail(event.handlerTag)

        return
      }

      const touch = event.allTouches[0]
      swipe.set(
        touch
          ? beginReaderSwipe(
              {
                x: touch.absoluteX,
                y: touch.absoluteY,
                time: Date.now(),
                pointers: event.numberOfTouches,
              },
              width,
            )
          : null,
      )

      if (!swipe.get()) GestureStateManager.fail(event.handlerTag)
    },
    onTouchesMove: (event) => {
      'worklet'
      const current = swipe.get()
      const touch = event.allTouches[0]

      if (
        !current ||
        !touch ||
        event.numberOfTouches !== 1 ||
        Math.abs(touch.absoluteY - current.origin.y) > 40
      ) {
        swipe.set(null)
        GestureStateManager.fail(event.handlerTag)

        return
      }

      if (current.axis !== 'pending') return

      const moved = moveReaderSwipe(current, {
        x: touch.absoluteX,
        y: touch.absoluteY,
        time: Date.now(),
        pointers: event.numberOfTouches,
      })

      swipe.set(moved)

      if (!moved || moved.axis === 'vertical') GestureStateManager.fail(event.handlerTag)
    },
    onUpdate: (event) => {
      'worklet'

      if (!enabled.get() || settling.get()) return

      const moved = moveReaderSwipe(swipe.get(), {
        x: event.absoluteX,
        y: event.absoluteY,
        time: Date.now(),
        pointers: event.numberOfPointers,
      })

      swipe.set(moved)
      const dx = readerSwipeOffset(moved)
      cancelAnimation(offset)
      offset.set(reduced ? 0 : readerSwipeOffset(moved, dx < 0 ? older : newer))
    },
    onDeactivate: (event) => {
      'worklet'

      const direction = !event.canceled
        ? finishReaderSwipe(
            swipe.get(),
            { x: event.absoluteX, y: event.absoluteY, time: Date.now(), pointers: 1 },
            event.velocityX / 1000,
          )
        : null

      swipe.set(null)

      if (!enabled.get() || !direction || !(direction === 'older' ? older : newer)) {
        offset.set(reduced ? 0 : withSpring(0, spring))

        return
      }

      settling.set(true)
      offset.set(reduced ? 0 : withSpring(direction === 'older' ? -24 : 24, spring))
      scheduleOnRN(onSwipe, direction)
    },
    onFinalize: () => {
      'worklet'
      swipe.set(null)

      if (!settling.get()) offset.set(reduced ? 0 : withSpring(0, spring))
    },
  })

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }))
  const scroll = useNativeGesture({ requireToFail: pan, cancelsJSResponder: false })

  return (
    <GestureHandlerRootView style={{ flex: 1, overflow: 'hidden' }}>
      <SwipeGestureContext value={{ pan, scroll }}>
        <GestureDetector gesture={pan}>
          <View collapsable={false} style={{ flex: 1 }}>
            <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>
          </View>
        </GestureDetector>
      </SwipeGestureContext>
    </GestureHandlerRootView>
  )
}
