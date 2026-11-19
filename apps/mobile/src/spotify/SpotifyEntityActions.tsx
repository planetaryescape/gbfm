import { SPOTIFY_ENTITY_KIND, spotifyEntityFromUrl, type SpotifyEntityRef } from '@gbfm/spotify'
import { type ReactNode, useLayoutEffect, useState } from 'react'
import { Linking, Text, TouchableOpacity, View } from 'react-native'

import { useThemeColors } from '@/theme/colors'

import { SpotifyConnectionState, useSpotifyConnection } from './connection'
import { spotifyEntityLifetime, runSpotifyEntityAction } from './entityLifetime'
import type { SpotifyEntityAction } from './entityOperation'
import { spotifyLifecycle } from './runtime'
import { SPOTIFY_GREEN, SpotifyIcon } from './SpotifyIcon'

type Props = {
  url: string
  onNotice: (message: string) => void
}

export type SpotifyEntityControl = {
  readonly action: SpotifyEntityAction
  readonly label: string
  readonly accessibilityLabel: string
}

export type SpotifyEntityControls = {
  readonly controls: ReadonlyArray<SpotifyEntityControl>
  readonly pending: SpotifyEntityAction | null
  readonly run: (action: SpotifyEntityAction) => void
}

const entityNoun = {
  [SPOTIFY_ENTITY_KIND.TRACK]: 'track',
  [SPOTIFY_ENTITY_KIND.ALBUM]: 'album',
  [SPOTIFY_ENTITY_KIND.PLAYLIST]: 'playlist',
} satisfies Record<SpotifyEntityRef['kind'], string>

const pendingLabels = {
  play: 'Playing...',
  queue: 'Queueing...',
  save: 'Saving...',
} satisfies Record<SpotifyEntityAction, string>

export const spotifyControlLabel = (
  control: SpotifyEntityControl,
  pending: SpotifyEntityAction | null,
) => (pending === control.action ? pendingLabels[control.action] : control.label)

const entityControls = (entity: SpotifyEntityRef): ReadonlyArray<SpotifyEntityControl> => {
  const noun = entityNoun[entity.kind]

  const controls: Array<SpotifyEntityControl> = [
    { action: 'play', label: 'Play', accessibilityLabel: `Play ${noun} on Spotify` },
    { action: 'queue', label: 'Queue', accessibilityLabel: `Add ${noun} to Spotify queue` },
  ]

  if (entity.kind !== SPOTIFY_ENTITY_KIND.PLAYLIST)
    controls.push({
      action: 'save',
      label: 'Save',
      accessibilityLabel: `Save ${noun} to your Spotify library`,
    })

  return controls
}

export function SpotifyEntityController({
  url,
  onNotice,
  children,
}: Props & { readonly children: (controls: SpotifyEntityControls) => ReactNode }) {
  const connection = useSpotifyConnection((state) => state)
  const entity = spotifyEntityFromUrl(url)
  const generation = spotifyLifecycle.current()

  if (!entity || !SpotifyConnectionState.$is('Connected')(connection)) return null

  return (
    <EntityController
      key={`${generation}:${url}`}
      url={url}
      onNotice={onNotice}
      entity={entity}
      generation={generation}>
      {children}
    </EntityController>
  )
}

function EntityController({
  url,
  onNotice,
  entity,
  generation,
  children,
}: Props & {
  readonly entity: SpotifyEntityRef
  readonly generation: number
  readonly children: (controls: SpotifyEntityControls) => ReactNode
}) {
  const [pending, setPending] = useState<SpotifyEntityAction | null>(null)
  const [lifetime] = useState(() => spotifyEntityLifetime())

  useLayoutEffect(() => {
    lifetime.activate()

    return lifetime.dispose
  }, [lifetime])

  const run = (action: SpotifyEntityAction) =>
    void runSpotifyEntityAction({
      lifetime,
      lifecycle: spotifyLifecycle,
      generation,
      entity,
      action,
      setPending,
      notice: onNotice,
      open: () => void Linking.openURL(url),
    })

  return children({ controls: entityControls(entity), pending, run })
}

export function SpotifyEntityActions({ url, onNotice }: Props) {
  return (
    <SpotifyEntityController url={url} onNotice={onNotice}>
      {(controls) => <ActionBar {...controls} />}
    </SpotifyEntityController>
  )
}

function ActionBar({ controls, pending, run }: SpotifyEntityControls) {
  const colors = useThemeColors()

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
      {controls.map((control, index) => {
        const primary = control.action === 'play'

        return (
          <View key={control.action} style={{ flexDirection: 'row', alignSelf: 'stretch' }}>
            {index > 0 ? (
              <View
                style={{ width: 1, alignSelf: 'stretch', backgroundColor: `${colors.muted}40` }}
              />
            ) : null}
            <TouchableOpacity
              accessibilityRole='button'
              accessibilityLabel={control.accessibilityLabel}
              disabled={pending !== null}
              onPress={() => run(control.action)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                backgroundColor: primary ? `${SPOTIFY_GREEN}1a` : undefined,
                opacity: pending !== null ? 0.6 : 1,
              }}>
              {primary ? <SpotifyIcon size={12} /> : null}
              <Text
                style={{
                  color: primary ? colors.strong : colors.muted,
                  fontSize: 12,
                  fontWeight: '600',
                }}>
                {spotifyControlLabel(control, pending)}
              </Text>
            </TouchableOpacity>
          </View>
        )
      })}
    </View>
  )
}
