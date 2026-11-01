import { createContext, type PropsWithChildren, useContext } from 'react'
import { ScrollView, type ScrollViewProps, View } from 'react-native'
import {
  GestureDetector,
  GestureStateManager,
  useNativeGesture,
  usePanGesture,
  type PanGesture,
  type NativeGesture,
} from 'react-native-gesture-handler'
import { scheduleOnUI } from 'react-native-worklets'

export const SwipeGestureContext = createContext<{
  readonly pan: PanGesture
  readonly scroll: NativeGesture
} | null>(null)

export function ReaderScrollView(props: ScrollViewProps) {
  const gestures = useContext(SwipeGestureContext)

  const horizontal = useNativeGesture({
    block: gestures?.pan,
    simultaneousWith: gestures?.scroll,
    cancelsJSResponder: false,
  })

  const scroll = <ScrollView {...props} />

  return gestures ? (
    <GestureDetector gesture={props.horizontal ? horizontal : gestures.scroll}>
      {scroll}
    </GestureDetector>
  ) : (
    scroll
  )
}

/** A nested Text link has no independent native view for a GestureDetector wrapper. */
export function useInlineSwipeExclusion() {
  const gestures = useContext(SwipeGestureContext)

  return () => {
    if (!gestures) return
    scheduleOnUI((tag: number) => {
      'worklet'
      GestureStateManager.fail(tag)
    }, gestures.pan.handlerTag)
  }
}

export function SwipeExclusion({
  children,
  disabled = false,
}: PropsWithChildren<{ readonly disabled?: boolean }>) {
  const gestures = useContext(SwipeGestureContext)

  const exclusion = usePanGesture({
    block: gestures?.pan,
    simultaneousWith: gestures?.scroll,
    enabled: Boolean(gestures) && !disabled,
    cancelsTouchesInView: false,
    cancelsJSResponder: false,
    activeOffsetX: [-2, 2],
    failOffsetY: [-4, 4],
  })

  if (!gestures || disabled) return <>{children}</>

  return (
    <GestureDetector gesture={exclusion}>
      <View collapsable={false}>{children}</View>
    </GestureDetector>
  )
}
