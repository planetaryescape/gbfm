import { Component } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Layer, Schema } from 'effect'

import { PerformSpotify, ReadSpotifyStatus } from '../spotify/commands'
import { SpotifyProvider } from '../spotify/provider'
import { ReaderPageProps } from './contracts'
import { ReaderPage } from './page'

export const ReaderSsrApplication = Html.component({
  name: 'ReaderSsrApplication',
  props: ReaderPageProps,
  model: Schema.Null,
  message: Schema.Never,
})
  .make({
    init: () => null,
    update: ($) => $.model,
    view: (h) =>
      SpotifyProvider(h, {
        props: { identity: h.props.principal?.id ?? 'anonymous' },
        view: () => ReaderPage(h, { props: h.props }),
      }),
  })
  .pipe(Component.provide(Layer.mergeAll(PerformSpotify.layer, ReadSpotifyStatus.layer)))
