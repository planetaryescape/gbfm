import { spotifyEntityFromUrl } from '@gbfm/spotify/entity'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { iconPaths, lucide } from '../view/icons'
import { Message, operationState, type Model } from './playback'

const onboardingTarget = 'spotify:onboarding'

export interface ReadingSpotify<M> {
  readonly model: Model
  readonly toMessage: (message: Message) => M
  readonly interactive: boolean
}

const actionButton = <M>(
  h: HtmlBuilder<M>,
  { model, toMessage, interactive }: ReadingSpotify<M>,
  action: 'connect' | 'play' | 'queue' | 'save',
  url: string,
  label: string,
  icon: string | null,
) => {
  const { busy, target } = operationState(model)

  return h.button(
    [
      h.Type('button'),
      h.Class(`spotlight-action spotlight-action-${action}`),
      h.Disabled(!interactive || model.status === null || busy),
      h.AriaBusy(busy && target === url),
      h.OnClick(toMessage(Message.Requested({ action, url }))),
    ],
    [...(icon ? [lucide(icon, 'h-4 w-4')] : []), label],
  )
}

/** Play, queue and save controls for one music card, or a connect prompt when Spotify is not linked. */
export const cardActions = <M>(
  h: HtmlBuilder<M>,
  spotify: ReadingSpotify<M>,
  links: ReadonlyArray<{ readonly platform: string; readonly url: string }>,
): Html => {
  const url = links.find(
    (link) => link.platform === 'spotify' && spotifyEntityFromUrl(link.url),
  )?.url

  if (!url) return h.empty

  const { target, notice } = operationState(spotify.model)
  const savable = spotifyEntityFromUrl(url)?.kind !== 'playlist'

  return h.div(
    [h.Class('spotlight-actions not-prose')],
    [
      h.div(
        [h.Class('spotlight-action-row')],
        spotify.model.status?.connected
          ? [
              actionButton(h, spotify, 'play', url, 'Play', iconPaths.play),
              actionButton(h, spotify, 'queue', url, 'Queue', iconPaths.listPlus),
              ...(savable ? [actionButton(h, spotify, 'save', url, 'Save', iconPaths.heart)] : []),
            ]
          : [actionButton(h, spotify, 'connect', url, 'Connect Spotify to play', null)],
      ),
      target === url && notice
        ? h.p([h.Role('status'), h.Class('spotlight-action-notice')], [notice])
        : h.empty,
    ],
  )
}

/** The intro's invitation to link Spotify before reading, which readers can skip by starting. */
export const onboarding = <M>(h: HtmlBuilder<M>, spotify: ReadingSpotify<M>): Html => {
  const { target, notice } = operationState(spotify.model)
  const status = spotify.model.status

  return h.aside(
    [h.Class('spotlight-onboarding not-prose')],
    status?.connected
      ? [
          h.p([h.Class('spotlight-onboarding-title')], ['Spotify connected']),
          h.p([], [`Listening as ${status.name}. Play, queue and save from any card as you read.`]),
        ]
      : [
          h.p([h.Class('spotlight-onboarding-title')], ['Listen as you read']),
          h.p(
            [],
            [
              'Connect Spotify to play, queue and save the music in this post as you go. Playing needs Spotify Premium and an open Spotify app.',
            ],
          ),
          actionButton(h, spotify, 'connect', onboardingTarget, 'Connect Spotify', null),
          target === onboardingTarget && notice
            ? h.p([h.Role('status'), h.Class('spotlight-action-notice')], [notice])
            : h.empty,
        ],
  )
}
