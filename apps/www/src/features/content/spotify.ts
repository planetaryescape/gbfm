import { UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { spotifyEntityFromUrl } from '@gbfm/spotify/entity'
import { Predicate, Schema } from 'effect'

import { iconPaths, pixelIcon, pixelPlayPath } from '../../ui/icons'
import { ReadSpotifyStatus } from '../spotify/commands'
import { type SpotifyAction, SpotifyProviderMessage } from '../spotify/domain'
import { SpotifyLoadRecovery } from '../spotify/load-recovery'
import { SpotifyProvider } from '../spotify/provider'

export const SpotlightSpotifyProps = Schema.Struct({
  identity: Schema.String,
  url: Schema.String,
  onboarding: Schema.Boolean,
})

export const SpotlightSpotifyMessage = UiSchema.TaggedEnum({
  ClickedConnect: {},
  ClickedPlay: {},
  ClickedQueue: {},
  ClickedSave: {},
  ClickedRetryStatus: {},
})

const SpotlightSpotifyControls = Html.component({
  name: 'SpotlightSpotifyControls',
  props: Schema.Struct({
    ...SpotlightSpotifyProps.fields,
    revision: Schema.Number,
    interactive: Schema.Boolean,
    busy: Schema.Boolean,
    target: Schema.NullOr(Schema.String),
    notice: Schema.String,
    recovery: Schema.optional(Schema.Literal('reload')),
  }),
  model: Schema.Null,
  message: SpotlightSpotifyMessage,
  restore: false,
  queries: {
    status: {
      query: ReadSpotifyStatus,
      args: ({ props }) =>
        props.interactive ? { identity: props.identity, revision: props.revision } : undefined,
    },
  },
}).make({
  init: () => null,
  update: ($, message) => {
    const provider = $.props

    if (!provider.interactive || provider.busy) return $.model

    const status = $.queries.status
    const connected = Predicate.isTagged(status, 'Success') && status.value.connected

    const operation = (action: typeof SpotifyAction.Type) => {
      if (!Predicate.isTagged(status, 'Success')) return $.model

      if (action !== 'connect' && !connected) return $.model

      if (action === 'connect' && connected) return $.model

      if (action === 'save' && spotifyEntityFromUrl($.props.url)?.kind === 'playlist')
        return $.model

      if (action !== 'connect' && !spotifyEntityFromUrl($.props.url)) return $.model

      return $.send(
        SpotifyProvider,
        SpotifyProviderMessage.RequestedPlayback({ url: $.props.url, action }),
      )
    }

    return SpotlightSpotifyMessage.match(message, {
      ClickedConnect: () => operation('connect'),
      ClickedPlay: () => operation('play'),
      ClickedQueue: () => operation('queue'),
      ClickedSave: () => operation('save'),
      ClickedRetryStatus: () =>
        $.send(SpotifyProvider, SpotifyProviderMessage.RequestedRefreshStatus()),
    })
  },
  view: (h) => {
    const provider = h.props
    const interactive = provider.interactive
    const result = h.queries.status
    const status = Predicate.isTagged(result, 'Success') ? result.value : null

    const button = (
      label: string,
      message: typeof SpotlightSpotifyMessage.Type,
      icon: string | null,
    ) =>
      h.button
        .attr('type', 'button')
        .class('btn spotlight-action')
        .disabled(!interactive || provider.busy || status === null)
        .attr('aria-busy', String(provider.busy && provider.target === h.props.url))
        .on('click', message)
        .children(icon && pixelIcon(h, icon, 'h-5 w-5', label === 'Play'), label)

    const notice =
      provider.target === h.props.url &&
      provider.notice !== '' &&
      h.p.attr('role', 'status').class('spotlight-action-notice').children(provider.notice)

    const retry =
      Predicate.isTagged(result, 'Failure') &&
      h.div.children(
        h.p.attr('role', 'status').children('Spotify is unavailable. You can keep reading.'),
        h.button
          .attr('type', 'button')
          .disabled(!interactive || provider.busy)
          .on('click', SpotlightSpotifyMessage.ClickedRetryStatus())
          .children('Retry Spotify'),
      )

    const reload =
      (Predicate.isTagged(result, 'Failure') ||
        (provider.target === h.props.url && provider.recovery === 'reload')) &&
      SpotifyLoadRecovery(h, {
        props: { interactive, busy: provider.busy },
      })

    if (h.props.onboarding)
      return h.aside
        .class('spotlight-onboarding not-prose')
        .children(
          status?.connected
            ? h.div.children(
                h.p.class('spotlight-onboarding-title').children('Spotify connected'),
                h.p.children(
                  `Listening as ${status.name}. Play, queue and save from any card as you read.`,
                ),
              )
            : h.div.children(
                h.p.class('spotlight-onboarding-title').children('Listen as you read'),
                h.p.children(
                  'Connect Spotify to play, queue and save the music in this post as you go. Playing needs Spotify Premium and an open Spotify app.',
                ),
                button('Connect Spotify', SpotlightSpotifyMessage.ClickedConnect(), null),
                retry,
                notice,
                reload,
              ),
        )

    if (!status?.connected || !spotifyEntityFromUrl(h.props.url)) return h.text('')

    return h.div
      .class('spotlight-actions not-prose')
      .children(
        h.div
          .class('spotlight-action-row')
          .children(
            button('Play', SpotlightSpotifyMessage.ClickedPlay(), pixelPlayPath),
            button('Queue', SpotlightSpotifyMessage.ClickedQueue(), iconPaths.listPlus),
            spotifyEntityFromUrl(h.props.url)?.kind !== 'playlist' &&
              button('Save', SpotlightSpotifyMessage.ClickedSave(), iconPaths.heart),
          ),
        notice,
        reload,
      )
  },
})

export const SpotlightSpotify = Html.component({
  name: 'SpotlightSpotify',
  props: SpotlightSpotifyProps,
  model: Schema.Null,
  message: Schema.Never,
  reads: { provider: SpotifyProvider },
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    SpotlightSpotifyControls(h, {
      props: {
        ...h.reads.provider,
        url: h.props.url,
        onboarding: h.props.onboarding,
        interactive: h.reads.provider.interactive && h.reads.provider.identity === h.props.identity,
      },
    }),
})
