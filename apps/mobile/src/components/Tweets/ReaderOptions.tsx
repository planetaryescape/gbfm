import type { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import { radii } from '@gbfm/theme'
import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { nextUnread } from '@/tweets/readerState'

import { ReaderButton } from './ReaderButton'
import { ReaderMonths } from './ReaderMonths'

type Props = {
  readonly visible: boolean
  readonly navigation: MicroPostNeighboursResponse | null
  readonly busy: boolean
  readonly failed: boolean
  readonly onClose: () => void
  readonly onGo: (slug: string | null) => void
  readonly onRandom: () => void
  readonly onReset: () => void
  readonly onRetry: () => void
  readonly onNewer: () => void
  readonly onOlder: () => void
}

export function ReaderOptions(props: Props) {
  const colors = useThemeColors()
  const target = nextUnread(props.navigation)
  const [dates, setDates] = useState(false)

  const close = () => {
    setDates(false)
    props.onClose()
  }

  const reset = () =>
    Alert.alert(
      'Reset reading history?',
      'Mark every tweet as unread again and start from the latest. This also resets your signed-in reading history on web.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: props.onReset },
      ],
    )

  return (
    <Modal visible={props.visible} animationType='slide' transparent onRequestClose={close}>
      <View
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: withAlpha(colors.shadow, 0.5),
        }}>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Close reading options'
          onPress={close}
          style={{ flex: 1 }}
        />
        <SafeAreaView
          edges={['bottom']}
          style={{
            maxHeight: '75%',
            borderTopLeftRadius: radii.overlay,
            borderTopRightRadius: radii.overlay,
            overflow: 'hidden',
            backgroundColor: colors.background,
            borderTopWidth: 1,
            borderColor: colors.muted,
          }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: 20,
            }}>
            <Text
              accessibilityRole='header'
              style={{ color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 18 }}>
              {dates ? 'Visit a month' : 'Reading options'}
            </Text>
            <ReaderButton
              label={dates ? 'Back' : 'Close'}
              quiet
              onPress={dates ? () => setDates(false) : close}
            />
          </View>
          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, gap: 14 }}>
            {dates ? (
              <ReaderMonths
                timeline={props.navigation?.timeline ?? []}
                onGo={(slug) => {
                  setDates(false)
                  props.onGo(slug)
                }}
              />
            ) : (
              <>
                <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>
                  {props.navigation
                    ? `${props.navigation.unreadCount} unread`
                    : props.failed
                      ? 'Unread navigation unavailable'
                      : 'Checking unread…'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <ReaderButton
                      label='Newer tweet'
                      glyph='chevronLeft'
                      disabled={props.busy || !props.navigation?.newer}
                      onPress={props.onNewer}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ReaderButton
                      label='Older tweet'
                      glyph='chevronRight'
                      disabled={props.busy || !props.navigation?.older}
                      onPress={props.onOlder}
                    />
                  </View>
                </View>
                {'slug' in target ? (
                  <ReaderButton
                    label='Next unread'
                    primary
                    disabled={props.busy}
                    onPress={() => props.onGo(target.slug)}
                  />
                ) : target.kind === 'caught-up' ? (
                  <View style={{ gap: 8 }}>
                    <Text
                      accessibilityRole='text'
                      style={{ color: colors.accent, fontFamily: fonts.mono }}>
                      Caught up
                    </Text>
                    <ReaderButton
                      label='Start over'
                      primary
                      disabled={props.busy}
                      onPress={reset}
                    />
                  </View>
                ) : props.failed ? (
                  <ReaderButton label='Retry navigation' onPress={props.onRetry} />
                ) : null}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <ReaderButton
                      label='Latest'
                      disabled={props.busy}
                      onPress={() => props.onGo(null)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ReaderButton
                      label='Surprise me'
                      disabled={props.busy || !props.navigation || target.kind === 'caught-up'}
                      onPress={props.onRandom}
                    />
                  </View>
                </View>
                <ReaderButton
                  label='Visit a month'
                  quiet
                  disabled={props.busy || !props.navigation?.timeline.length}
                  onPress={() => setDates(true)}
                />
                <ReaderButton
                  label='Reset reading history…'
                  disabled={props.busy || !props.navigation}
                  onPress={reset}
                />
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  )
}
