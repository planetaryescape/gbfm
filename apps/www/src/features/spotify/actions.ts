import { Command } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { spotifyEntityFromUrl } from '@gbfm/spotify/entity'
import { Effect, Match, Predicate, Schema } from 'effect'

import { disconnected } from '../../spotify/connection'
import { iconPaths, lucide } from '../../ui/icons'
import { ReadSpotifyStatus } from './commands'
import { SpotifyControlMessage, SpotifyProviderMessage } from './domain'
import { SpotifyProvider } from './provider'

const SpotifyStatusControls = Html.component({
  name: 'SpotifyStatusControls',
  props: Schema.Struct({
    mode: Schema.Literals(['actions', 'onboarding', 'connection']),
    url: Schema.String,
    reading: Schema.Boolean,
    identity: Schema.String,
    revision: Schema.Number,
    interactive: Schema.Boolean,
    busy: Schema.Boolean,
    target: Schema.NullOr(Schema.String),
    notice: Schema.String,
  }),
  model: Schema.Null,
  message: SpotifyControlMessage,
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
    if (
      !$.props.interactive ||
      ($.props.busy && !Predicate.isTagged(message, 'RequestedDisconnect'))
    )
      return $.model

    return $.send(SpotifyProvider, message)
  },
  view: (h) => {
    const props = h.props
    const result = h.queries.status

    const status = Match.value(result).pipe(
      Match.tag('Success', (result) => result.value),
      Match.tag('Failure', () => disconnected),
      Match.orElse(() => null),
    )

    const unavailable = Predicate.isTagged(result, 'Failure')

    const refresh = h.button
      .attr('type', 'button')
      .class('btn')
      .disabled(!props.interactive || props.busy)
      .on('click', SpotifyProviderMessage.RequestedRefreshStatus())
      .children('Refresh Spotify status')

    const button = (action: 'connect' | 'play' | 'queue' | 'save', label: string, icon: string) =>
      h.button
        .attr('type', 'button')
        .class(props.reading ? `btn spotlight-action spotlight-action-${action}` : 'btn')
        .disabled(!props.interactive || props.busy || status === null)
        .attr('aria-busy', String(props.busy && props.target === props.url))
        .on('click', SpotifyProviderMessage.RequestedPlayback({ action, url: props.url }))
        .children(lucide(h, icon, 'size-5'), label)

    if (props.mode === 'connection')
      return h.section
        .class('space-y-3')
        .children(
          h.h2('Spotify'),
          h.p(
            status?.connected
              ? `Connected as ${status.name}`
              : 'Connect Spotify to play, queue and save music.',
          ),
          status?.connected || props.busy
            ? h.button
                .attr('type', 'button')
                .class('btn')
                .disabled(!props.interactive)
                .on('click', SpotifyProviderMessage.RequestedDisconnect())
                .children('Disconnect Spotify')
            : button('connect', 'Connect Spotify', iconPaths.music),
          refresh,
          h.p.attr('role', 'status').children(props.notice),
        )

    if (props.mode === 'onboarding') {
      if (status?.connected)
        return h.aside
          .class('spotlight-onboarding not-prose')
          .children(
            h.p.class('spotlight-onboarding-title').children('Spotify connected'),
            h.p(`Listening as ${status.name}. Play, queue and save from any card as you read.`),
          )

      return h.aside
        .class('spotlight-onboarding not-prose')
        .children(
          h.p.class('spotlight-onboarding-title').children('Listen as you read'),
          h.p(
            'Connect Spotify to play, queue and save the music in this post as you go. Playing needs Spotify Premium and an open Spotify app.',
          ),
          button('connect', 'Connect Spotify', iconPaths.music),
          props.target === props.url && h.p.attr('role', 'status').children(props.notice),
          unavailable && refresh,
        )
    }

    const entity = spotifyEntityFromUrl(props.url)

    if (!entity || (props.reading && !status?.connected)) return h.text('')

    return h.div
      .class(
        props.reading
          ? 'spotlight-actions not-prose'
          : 'relative z-10 space-y-2 border-t border-border/40 px-4 py-3',
      )
      .children(
        h.div
          .class(props.reading ? 'spotlight-action-row' : 'flex flex-wrap gap-2')
          .children(
            status?.connected
              ? h.div
                  .class('flex flex-wrap gap-2')
                  .children(
                    button('play', props.reading ? 'Play' : 'Play on Spotify', iconPaths.play),
                    button(
                      'queue',
                      props.reading ? 'Queue' : 'Queue on Spotify',
                      iconPaths.listPlus,
                    ),
                    props.reading &&
                      entity.kind !== 'playlist' &&
                      button('save', 'Save', iconPaths.heart),
                  )
              : button('connect', 'Connect Spotify', iconPaths.music),
          ),
        !props.reading &&
          h.p
            .class('text-xs text-muted-foreground')
            .children(
              'Spotify Premium and an active Spotify device required. Audio plays in Spotify, not the mix player.',
            ),
        props.target === props.url &&
          props.notice !== '' &&
          h.p.attr('role', 'status').class('text-xs text-muted-foreground').children(props.notice),
        unavailable && refresh,
      )
  },
})

export const SpotifyActions = Html.component({
  name: 'SpotifyActions',
  props: Schema.Struct({ url: Schema.String, reading: Schema.optional(Schema.Boolean) }),
  model: Schema.Null,
  message: Schema.Never,
  reads: { provider: SpotifyProvider },
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    SpotifyStatusControls(h, {
      props: {
        ...h.reads.provider,
        mode: 'actions',
        url: h.props.url,
        reading: h.props.reading ?? false,
      },
    }),
})

export const SpotifyOnboarding = Html.component({
  name: 'SpotifyOnboarding',
  model: Schema.Null,
  message: Schema.Never,
  reads: { provider: SpotifyProvider },
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    SpotifyStatusControls(h, {
      props: { ...h.reads.provider, mode: 'onboarding', url: 'spotify:onboarding', reading: true },
    }),
})

const StartSpotifyCallback = Command.make('StartSpotifyCallback', { args: {} }, () =>
  Effect.succeed(SpotifyProviderMessage.RequestedCompleteCallback()),
)

export const SpotifyCallback = Html.component({
  name: 'SpotifyCallback',
  restore: false,
  model: Schema.Null,
  message: SpotifyControlMessage,
  reads: { provider: SpotifyProvider },
}).make({
  init: ($) => $.set(null).run(StartSpotifyCallback.make()),
  update: ($, message) => $.send(SpotifyProvider, message),
  view: (h) => {
    const { notice, busy } = h.reads.provider
    const failed = !busy && notice.length > 0 && notice !== 'Redirecting…'

    return h.section
      .class('page')
      .children(
        h.h1('Connecting Spotify'),
        h.p
          .attr('role', failed ? 'alert' : 'status')
          .children(notice || 'Completing Spotify authorization…'),
        h.a.attr('href', '/dashboard/integrations').children('Back to integrations'),
      )
  },
})

export const SpotifyConnectionControls = Html.component({
  name: 'SpotifyConnectionControls',
  model: Schema.Null,
  message: Schema.Never,
  reads: { provider: SpotifyProvider },
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    SpotifyStatusControls(h, {
      props: { ...h.reads.provider, mode: 'connection', url: 'spotify:settings', reading: false },
    }),
})
