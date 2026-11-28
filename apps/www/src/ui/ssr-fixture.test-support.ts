import { Component } from '@effect/ui'
import { Html, HtmlServer } from '@effect/ui/html'
import { RichContentDocument } from '@gbfm/rich-content/schema'
import { Effect, Layer, Schema } from 'effect'

import { nativePlayerServerLayer, PlayerProvider } from '../features/player/provider'
import { LoadMembership, MembershipHttp, SaveMembership } from '../features/public-actions/commands'
import { MembershipProvider } from '../features/public-actions/provider'
import { PerformSpotify, ReadSpotifyStatus } from '../features/spotify/commands'
import { SpotifyProvider } from '../features/spotify/provider'
import { SpotifyConnection } from '../spotify/connection'
import { artwork, imageSource } from './artwork'
import { richContentView, type RichContentViewOptions } from './rich-content/render'

const noBrowserHttp = Effect.die(new Error('Browser HTTP must not execute in presentation SSR.'))

const presentationServices = Layer.mergeAll(
  nativePlayerServerLayer,
  Layer.mergeAll(LoadMembership.layer, SaveMembership.layer).pipe(
    Layer.provide(
      Layer.succeed(MembershipHttp, {
        request: () => noBrowserHttp,
        requestId: noBrowserHttp,
      }),
    ),
  ),
  Layer.mergeAll(ReadSpotifyStatus.layer, PerformSpotify.layer).pipe(
    Layer.provide(
      Layer.succeed(SpotifyConnection, {
        status: noBrowserHttp,
        connect: noBrowserHttp,
        disconnect: noBrowserHttp,
        completeCallback: noBrowserHttp,
        playback: () => noBrowserHttp,
      }),
    ),
  ),
)

export const RichContentSsrFixture = Html.component({
  name: 'RichContentPresentationSsrFixture',
  props: Schema.Struct({
    document: RichContentDocument,
    className: Schema.optional(Schema.String),
  }),
  model: Schema.Null,
  message: Schema.Never,
})
  .make({
    init: () => null,
    update: ($) => $.model,
    view: (h) =>
      PlayerProvider(h, {
        props: { principalId: null, principalKnown: true, returnTo: '/editorial/fixture' },
        view: () =>
          MembershipProvider(h, {
            props: { principalId: null, principalKnown: true },
            view: () =>
              SpotifyProvider(h, {
                props: { identity: 'anonymous' },
                view: () => richContentView(h, h.props.document, { className: h.props.className }),
              }),
          }),
      }),
  })
  .pipe(Component.provide(presentationServices))

export const renderRichContent = (
  document: RichContentDocument,
  options: RichContentViewOptions = {},
) =>
  Effect.runPromise(
    HtmlServer.renderToHtml(RichContentSsrFixture, { document, className: options.className }).pipe(
      Effect.map(({ html }) => html),
    ),
  )

const ArtworkFixture = Html.component({
  name: 'ArtworkPresentationSsrFixture',
  props: Schema.Struct({
    src: Schema.NullOr(Schema.String),
    alt: Schema.String,
    sizes: Schema.String,
    eager: Schema.Boolean,
    className: Schema.String,
    dimensions: Schema.Struct({ width: Schema.Number, height: Schema.Number }),
    sourceOnly: Schema.Boolean,
  }),
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    h.props.sourceOnly
      ? imageSource(h, h.props.src ?? '')
      : artwork(
          h,
          h.props.src,
          h.props.alt,
          h.props.sizes,
          h.props.eager,
          h.props.className,
          h.props.dimensions,
        ),
})

export const renderArtwork = (input: {
  readonly src: string | null
  readonly alt?: string
  readonly sizes?: string
  readonly eager?: boolean
  readonly className?: string
  readonly dimensions?: { readonly width: number; readonly height: number }
  readonly sourceOnly?: boolean
}) =>
  Effect.runPromise(
    HtmlServer.renderToHtml(ArtworkFixture, {
      src: input.src,
      alt: input.alt ?? 'Cover',
      sizes: input.sizes ?? '160px',
      eager: input.eager ?? false,
      className: input.className ?? '',
      dimensions: input.dimensions ?? { width: 640, height: 640 },
      sourceOnly: input.sourceOnly ?? false,
    }).pipe(Effect.map(({ html }) => html)),
  )
