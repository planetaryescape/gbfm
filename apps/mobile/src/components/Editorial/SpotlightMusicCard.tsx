import type { RichContentBlock } from '@gbfm/rich-content/schema'
import { radii } from '@gbfm/theme'
import { useState } from 'react'
import { Image, Linking, Pressable, Text, View } from 'react-native'

import { SpotifyEntityActions } from '@/spotify/SpotifyEntityActions'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { Panel } from './Panel'

type MusicEmbed = Extract<RichContentBlock, { readonly _tag: 'MusicEmbed' }>

const entityLabels = new Map([
  ['album', 'Album'],
  ['playlist', 'Playlist'],
  ['track', 'Track'],
])

const platformLabels = new Map([
  ['spotify', 'Spotify'],
  ['deezer', 'Deezer'],
  ['bandcamp', 'Bandcamp'],
  ['apple_music', 'Apple Music'],
  ['youtube', 'YouTube'],
  ['youtube_music', 'YT Music'],
  ['tidal', 'Tidal'],
  ['soundcloud', 'SoundCloud'],
])

type Props = {
  readonly block: MusicEmbed
  readonly compact?: boolean
  readonly highlighted?: boolean
}

export function SpotlightMusicCard({ block, compact = false, highlighted = false }: Props) {
  const colors = useThemeColors()
  const [notice, setNotice] = useState('')
  const { music, blurb } = block
  const spotify = music.links.find((link) => link.platform === 'spotify')
  const links = music.links.filter((link) => platformLabels.has(link.platform))
  const cover = compact ? 64 : 88

  return (
    <Panel
      highlighted={highlighted}
      style={{ flex: compact ? 1 : undefined, gap: 12, padding: 14 }}>
      <View style={{ flexDirection: compact ? 'column' : 'row', gap: 12 }}>
        {music.imageUrl ? (
          <Image
            source={{ uri: music.imageUrl }}
            accessibilityLabel={`Artwork for ${music.title}`}
            style={{ width: cover, height: cover, borderRadius: radii.artwork }}
          />
        ) : null}
        <View style={{ flex: compact ? undefined : 1, gap: 2 }}>
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.mono,
              fontSize: 10,
              letterSpacing: 1.6,
            }}>
            {(entityLabels.get(music.entityType) ?? 'Music').toUpperCase()}
          </Text>
          <Text
            style={{
              color: colors.strong,
              fontFamily: fonts.monoSemiBold,
              fontSize: compact ? 14 : 16,
            }}>
            {music.title}
          </Text>
          {music.artists.length > 0 ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>
              {music.artists.join(', ')}
            </Text>
          ) : null}
        </View>
      </View>
      {blurb ? (
        <View style={{ borderLeftWidth: 2, borderColor: colors.accentSurface, paddingLeft: 12 }}>
          <Text
            style={{ color: colors.strong, fontFamily: fonts.mono, fontSize: 13, lineHeight: 20 }}>
            {blurb}
          </Text>
        </View>
      ) : null}
      {spotify ? (
        <View style={{ gap: 6 }}>
          <SpotifyEntityActions url={spotify.url} onNotice={setNotice} />
          {notice ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>
              {notice}
            </Text>
          ) : null}
        </View>
      ) : null}
      {links.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {links.map((link) => (
            <Pressable
              key={link.url}
              accessibilityRole='link'
              onPress={() => void Linking.openURL(link.url)}>
              <Text style={{ color: colors.muted, fontFamily: fonts.monoSemiBold, fontSize: 12 }}>
                {platformLabels.get(link.platform)} ↗
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Panel>
  )
}
