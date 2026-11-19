import { radii } from '@gbfm/theme'
import { Pressable, Text } from 'react-native'

import { SpotifyEntityController, spotifyControlLabel } from '@/spotify/SpotifyEntityActions'
import { SPOTIFY_GREEN, SpotifyIcon } from '@/spotify/SpotifyIcon'
import { useThemeColors, withAlpha } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { SwipeExclusion } from './SwipeExclusion'

export function TweetSpotifyActions({
  url,
  onNotice,
}: {
  readonly url: string
  readonly onNotice: (message: string) => void
}) {
  const colors = useThemeColors()

  return (
    <SpotifyEntityController url={url} onNotice={onNotice}>
      {({ controls, pending, run }) =>
        controls.map((control) => {
          const primary = control.action === 'play'

          return (
            <SwipeExclusion key={control.action}>
              <Pressable
                accessibilityRole='button'
                accessibilityLabel={control.accessibilityLabel}
                accessibilityState={{
                  disabled: pending !== null,
                  busy: pending === control.action,
                }}
                disabled={pending !== null}
                hitSlop={8}
                onPress={() => run(control.action)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: radii.control,
                  borderWidth: 1,
                  borderColor: primary
                    ? withAlpha(SPOTIFY_GREEN, 0.6)
                    : withAlpha(colors.muted, 0.4),
                  backgroundColor: primary ? withAlpha(SPOTIFY_GREEN, 0.12) : undefined,
                  opacity: pressed || (pending !== null && pending !== control.action) ? 0.6 : 1,
                })}>
                {primary ? <SpotifyIcon size={12} /> : null}
                <Text
                  style={{
                    color: primary ? colors.strong : colors.text,
                    fontFamily: primary ? fonts.monoSemiBold : fonts.mono,
                    fontSize: 12,
                  }}>
                  {spotifyControlLabel(control, pending)}
                </Text>
              </Pressable>
            </SwipeExclusion>
          )
        })
      }
    </SpotifyEntityController>
  )
}
