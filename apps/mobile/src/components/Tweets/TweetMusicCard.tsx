import { radii } from '@gbfm/theme'
import { useState } from 'react'
import { Image, Text, View } from 'react-native'

import type { TweetMusic } from '@/api/tweets'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'

import { TweetLink } from './TweetLink'

const COVER_SIZE = 88

const platformLabels = new Map([
  ['spotify', 'Spotify'],
  ['youtube', 'YouTube'],
  ['youtube_music', 'YT Music'],
  ['apple_music', 'Apple Music'],
  ['bandcamp', 'Bandcamp'],
  ['soundcloud', 'SoundCloud'],
  ['tidal', 'Tidal'],
  ['deezer', 'Deezer'],
  ['amazon_music', 'Amazon Music'],
  ['website', 'Website'],
  ['other', 'Link'],
])

const platformLabel = (platform: string) => platformLabels.get(platform) ?? platform

function StreamLink({ platform, url }: { platform: string; url: string }) {
  const label = platformLabel(platform)

  return <TweetLink href={url} label={`Open in ${label}`} />
}

export function TweetMusicCard({ music }: { music: TweetMusic }) {
  const colors = useThemeColors()
  const { entity, links } = music
  const [failed, setFailed] = useState(false)

  return (
    <View
      style={{
        borderRadius: radii.surface,
        borderWidth: 1,
        borderColor: colors.muted,
        backgroundColor: colors.surface,
        overflow: 'hidden',
      }}>
      <View style={{ flexDirection: 'row', gap: 12, padding: 12 }}>
        {entity.coverImageUrl && !failed ? (
          <Image
            source={{ uri: entity.coverImageUrl }}
            accessibilityLabel={`${entity.title} cover`}
            style={{ width: COVER_SIZE, height: COVER_SIZE, borderRadius: radii.artwork }}
            resizeMode='cover'
            onError={() => setFailed(true)}
          />
        ) : (
          <View
            style={{
              width: COVER_SIZE,
              height: COVER_SIZE,
              borderRadius: radii.artwork,
              backgroundColor: colors.background,
            }}
          />
        )}
        <View style={{ flex: 1, gap: 4, justifyContent: 'center' }}>
          <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 11 }}>
            {entity.type}
          </Text>
          <Text
            numberOfLines={3}
            style={{
              color: colors.strong,
              fontFamily: fonts.monoSemiBold,
              fontSize: 15,
              lineHeight: 20,
            }}>
            {entity.title}
          </Text>
          {entity.artistNames?.length ? (
            <Text
              numberOfLines={2}
              style={{ color: colors.text, fontFamily: fonts.mono, fontSize: 12 }}>
              {entity.artistNames.join(', ')}
            </Text>
          ) : null}
        </View>
      </View>
      {links.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            paddingHorizontal: 12,
            paddingBottom: 12,
          }}>
          {links.map((link) => (
            <StreamLink key={link.platform} platform={link.platform} url={link.url} />
          ))}
        </View>
      ) : null}
    </View>
  )
}
