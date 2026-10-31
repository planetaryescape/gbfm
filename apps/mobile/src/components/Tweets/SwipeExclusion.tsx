import { createContext, type PropsWithChildren, useContext } from 'react'
import { ScrollView, type ScrollViewProps, View } from 'react-native'
import {
  GestureDetector,
  usePanGesture,
  type PanGesture,
  type NativeGesture,
} from 'react-native-gesture-handler'

export const SwipeGestureContext = createContext<{
  readonly pan: PanGesture
  readonly scroll: NativeGesture
} | null>(null)

export function ReaderScrollView(props: ScrollViewProps) {
  const gestures = useContext(SwipeGestureContext)
  const scroll = <ScrollView {...props} />

  return gestures ? <GestureDetector gesture={gestures.scroll}>{scroll}</GestureDetector> : scroll
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
