import { SPOTIFY_ENTITY_KIND, spotifyEntityFromUrl, type SpotifyEntityRef } from '@gbfm/spotify'
import { useLayoutEffect, useState } from 'react'
import { Linking, Text, TouchableOpacity, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'

import { SpotifyConnectionState, useSpotifyConnection } from './connection'
import { spotifyEntityLifetime, runSpotifyEntityAction } from './entityLifetime'
import { spotifyLifecycle } from './runtime'
import { SPOTIFY_GREEN, SpotifyIcon } from './SpotifyIcon'

type Props = {
  url: string
  onNotice: (message: string) => void
}

const entityNoun = {
  [SPOTIFY_ENTITY_KIND.TRACK]: 'Track',
  [SPOTIFY_ENTITY_KIND.ALBUM]: 'Album',
  [SPOTIFY_ENTITY_KIND.PLAYLIST]: 'Playlist',
} satisfies Record<SpotifyEntityRef['kind'], string>

export function SpotifyEntityActions({ url, onNotice }: Props) {
  const connection = useSpotifyConnection((state) => state)
  const entity = spotifyEntityFromUrl(url)
  const generation = spotifyLifecycle.current()

  if (!entity || !SpotifyConnectionState.$is('Connected')(connection)) return null

  return (
    <EntityActions
      key={`${generation}:${url}`}
      url={url}
      onNotice={onNotice}
      entity={entity}
      generation={generation}
    />
  )
}

function EntityActions({
  url,
  onNotice,
  entity,
  generation,
}: Props & { readonly entity: SpotifyEntityRef; readonly generation: number }) {
  const [pending, setPending] = useState<'play' | 'queue' | null>(null)
  const colors = useThemeColors()
  const [lifetime] = useState(() => spotifyEntityLifetime())

  useLayoutEffect(() => {
    lifetime.activate()

    return lifetime.dispose
  }, [lifetime])

  const openInSpotify = () => {
    void Linking.openURL(url)
  }

  const run = (action: 'play' | 'queue') =>
    runSpotifyEntityAction({
      lifetime,
      lifecycle: spotifyLifecycle,
      generation,
      entity,
      action,
      setPending,
      notice: onNotice,
      open: openInSpotify,
    })

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 4,
        borderWidth: 1,
        borderColor: `${colors.muted}40`,
        overflow: 'hidden',
      }}>
      <TouchableOpacity
        accessibilityRole='button'
        accessibilityLabel={`Play ${entityNoun[entity.kind].toLowerCase()} on Spotify`}
        disabled={pending !== null}
        onPress={() => void run('play')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: `${SPOTIFY_GREEN}1a`,
          opacity: pending !== null ? 0.6 : 1,
        }}>
        <SpotifyIcon size={12} />
        <Text style={{ color: colors.strong, fontSize: 12, fontWeight: '600' }}>
          {pending === 'play' ? 'Playing...' : 'Play'}
        </Text>
      </TouchableOpacity>
      <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: `${colors.muted}40` }} />
      <TouchableOpacity
        accessibilityRole='button'
        accessibilityLabel={`Add ${entityNoun[entity.kind].toLowerCase()} to Spotify queue`}
        disabled={pending !== null}
        onPress={() => void run('queue')}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          opacity: pending !== null ? 0.6 : 1,
        }}>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>
          {pending === 'queue' ? 'Queueing...' : 'Queue'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}
