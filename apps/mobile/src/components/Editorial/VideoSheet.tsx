import { radii } from '@gbfm/theme'
import { Modal, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'

import { useTweetLink } from '@/components/Tweets/TweetLink'
import { PLAYER_ORIGIN, videoNavigationAllowed, videoWatchUrl } from '@/editorial/videoNavigation'
import { Glyph } from '@/icons/Glyph'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

const playerHtml = (id: string) => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
</head><body>
<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1&rel=0"
allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>
</body></html>`

type Props = {
  readonly id: string
  readonly title: string
  readonly canonicalUrl: string
  readonly visible: boolean
  readonly onClose: () => void
}

export function VideoSheet({ id, title, canonicalUrl, visible, onClose }: Props) {
  const colors = useThemeColors()
  const watch = useTweetLink(videoWatchUrl(canonicalUrl, id))

  return (
    <Modal
      visible={visible}
      animationType='slide'
      presentationStyle='pageSheet'
      onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}>
          <Text
            numberOfLines={2}
            style={{ flex: 1, color: colors.strong, fontFamily: fonts.monoSemiBold, fontSize: 15 }}>
            {title}
          </Text>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Close video'
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radii.round,
              backgroundColor: pressed ? `${colors.muted}30` : `${colors.muted}18`,
            })}>
            <Glyph name='close' size={18} color={colors.strong} />
          </Pressable>
        </View>
        <View style={{ aspectRatio: 16 / 9, backgroundColor: '#000' }}>
          {visible ? (
            <WebView
              source={{ html: playerHtml(id), baseUrl: PLAYER_ORIGIN }}
              allowsInlineMediaPlayback
              allowsFullscreenVideo
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              onShouldStartLoadWithRequest={(request) => videoNavigationAllowed(request.url, id)}
              onOpenWindow={() => {}}
              style={{ backgroundColor: '#000' }}
            />
          ) : null}
        </View>
        <Pressable
          accessibilityRole='link'
          onPress={() => {
            void watch.open()
          }}
          style={{ padding: 16 }}>
          <Text style={{ color: colors.muted, fontFamily: fonts.monoSemiBold, fontSize: 13 }}>
            Watch on YouTube ↗
          </Text>
        </Pressable>
        {watch.failed ? (
          <Text accessibilityRole='alert'>Could not open YouTube. Tap to retry.</Text>
        ) : null}
      </SafeAreaView>
    </Modal>
  )
}
