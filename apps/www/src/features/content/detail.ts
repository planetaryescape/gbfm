import { Command, Component, Subscription, UiSchema } from '@effect/ui'
import { Dialog } from '@effect/ui-kit/Dialog'
import { Html } from '@effect/ui/html'
import type { RichContentDocument } from '@gbfm/rich-content/schema'
import {
  spotlightSteps,
  spotlightStructure,
  stepAt,
  stepPosition,
} from '@gbfm/rich-content/spotlight'
import { Effect, Schema, Stream } from 'effect'

import { ContentItem } from '../../domain/content-item'
import { normalizeSpotlightProgress } from '../../domain/editorial/spotlight-location'
import { spotlightPresentation } from '../../domain/editorial/spotlight-presentation'
import { spotlightKeys } from '../../spotlight-keys'
import { readProgress, SpotlightProgress, writeProgress } from '../../spotlight-progress'
import { artwork } from '../../ui/artwork'
import { richContent } from '../../ui/rich-content/fallback'
import { richContentView } from '../../ui/rich-content/render'
import { spotlightView } from '../../ui/rich-content/spotlight'
import { Video } from '../../video'
import { contentTrack } from './cards'
import { PlaybackControls } from './playback-controls'
import { ContentMasthead, ContentMeta, DraftNotice, EmailUpdatesInvite } from './presentation'
import { SpotlightSpotify } from './spotify'

export const ContentDetailPageProps = Schema.Struct({
  item: ContentItem,
  kind: Schema.String,
  url: Schema.String,
  principalId: Schema.optional(Schema.NullOr(Schema.String)),
  hasActions: Schema.optional(Schema.Boolean),
})

export const ContentDetailPageModel = Schema.Struct({
  at: Schema.NullOr(Schema.String),
  seen: Schema.Array(Schema.String),
  direction: Schema.Literals(['none', 'forward', 'backward']),
  video: Schema.NullOr(Video),
  interacted: Schema.Boolean,
})

export type ContentDetailPageModel = typeof ContentDetailPageModel.Type

export const ContentDetailPageMessage = UiSchema.TaggedEnum({
  SteppedSpotlight: { at: Schema.NullOr(Schema.String) },
  RequestedPreviousEntry: {},
  RequestedNextEntry: {},
  RestoredSpotlight: { progress: Schema.NullOr(SpotlightProgress) },
  OpenedVideo: { video: Video },
  RequestedCloseVideoDialog: {},
})

export type ContentDetailPageMessage = typeof ContentDetailPageMessage.Type

export class SaveSpotlightProgress extends Command.Service<SaveSpotlightProgress>()(
  'content/SaveSpotlightProgress',
  { args: { progress: SpotlightProgress }, success: Component.Noop, mode: 'queue' },
) {
  static readonly layer = this.toLayer(({ progress }) =>
    Effect.sync(() => {
      writeProgress(progress)
      const url = new URL(window.location.href)

      if (url.pathname !== progress.path) return Component.noop

      if (progress.at === null) url.searchParams.delete('at')
      else url.searchParams.set('at', progress.at)
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      )
      const stage = document.querySelector<HTMLElement>('.spotlight-stage')

      if (document.activeElement === document.body) stage?.focus({ preventScroll: true })

      if (stage && getComputedStyle(stage).overflowY === 'auto') {
        stage.scrollTo({ top: 0, behavior: 'instant' })
      } else {
        document.querySelector('.content-detail')?.scrollIntoView({ block: 'start' })
      }

      return Component.noop
    }),
  )
}

const stepsOf = (document: RichContentDocument) =>
  spotlightSteps(spotlightStructure(spotlightPresentation(document.blocks).blocks))

const spotlightDocument = (props: typeof ContentDetailPageProps.Type) => {
  const document = props.item.richContent

  if (props.kind !== 'editorial' || !document) return null

  const preview =
    import.meta.env.DEV && new URL(props.url).searchParams.get('layout') === 'spotlight'

  return document.layout === 'spotlight' || preview ? document : null
}

export const ContentDetailPageNoDeps = Html.component({
  name: 'ContentDetailPage',
  props: ContentDetailPageProps,
  model: ContentDetailPageModel,
  message: ContentDetailPageMessage,
  slots: ['actions'],
  restore: (model): ContentDetailPageModel => ({ ...model, video: null, direction: 'none' }),
}).make({
  init: ($) => {
    const document = spotlightDocument($.props)
    const at = new URL($.props.url).searchParams.get('at')

    const progress = document
      ? normalizeSpotlightProgress(document, {
          path: new URL($.props.url).pathname,
          at,
          seen: [],
        })
      : { at: null, seen: [] }

    return {
      at: progress.at,
      seen: progress.seen,
      direction: 'none',
      video: null,
      interacted: false,
    }
  },
  subscriptions: ($) =>
    spotlightDocument($.props)
      ? [
          Subscription.make('RestoreSpotlight', [new URL($.props.url).pathname], () =>
            Stream.sync(() =>
              ContentDetailPageMessage.RestoredSpotlight({
                progress: readProgress(new URL($.props.url).pathname),
              }),
            ),
          ),
          Subscription.make('SpotlightKeyboard', [], () =>
            spotlightKeys<ContentDetailPageMessage>({
              previous: () => ContentDetailPageMessage.RequestedPreviousEntry(),
              next: () => ContentDetailPageMessage.RequestedNextEntry(),
            }),
          ),
        ]
      : [],
  update: ($, message) => {
    const document = spotlightDocument($.props)

    const step = (at: string | null) => {
      if (!document) return $.model

      const normalized = normalizeSpotlightProgress(document, {
        path: new URL($.props.url).pathname,
        at,
        seen: $.model.seen,
      })

      const steps = stepsOf(document)

      const offset = stepAt(steps, normalized.at) - stepAt(steps, $.model.at)
      let direction: ContentDetailPageModel['direction'] = 'none'

      if (offset > 0) direction = 'forward'

      if (offset < 0) direction = 'backward'

      const position = normalized.at ?? 'intro'

      const seen = normalized.seen.includes(position)
        ? normalized.seen
        : [...normalized.seen, position]

      return $.evolve({ at: normalized.at, seen, direction, interacted: true }).run(
        SaveSpotlightProgress.make({
          progress: { path: new URL($.props.url).pathname, at: normalized.at, seen },
        }),
      )
    }

    const relativeStep = (delta: number) => {
      if (!document) return $.model
      const steps = stepsOf(document)
      const index = Math.max(0, Math.min(steps.length - 1, stepAt(steps, $.model.at) + delta))
      const target = steps[index]

      return step(target ? stepPosition(target) : null)
    }

    return ContentDetailPageMessage.match(message, {
      SteppedSpotlight: ({ at }) => step(at),
      RequestedPreviousEntry: () => relativeStep(-1),
      RequestedNextEntry: () => relativeStep(1),
      RestoredSpotlight: ({ progress }) => {
        if (
          !document ||
          !progress ||
          $.model.interacted ||
          new URL($.props.url).searchParams.has('at')
        )
          return $.model

        const normalized = normalizeSpotlightProgress(document, progress)

        return $.evolve({ at: normalized.at, seen: normalized.seen })
      },
      OpenedVideo: ({ video }) => $.evolve({ video }),
      RequestedCloseVideoDialog: () => $.evolve({ video: null }),
    })
  },
  view: (h, model) => {
    const { item, kind } = h.props
    const spotlight = spotlightDocument(h.props)
    const showMasthead = !spotlight || model.at === null
    const presentation = spotlight ? spotlightPresentation(spotlight.blocks) : null
    const track = contentTrack(item)

    const body = item.richContent
      ? richContentView(h, item.richContent)
      : richContent(h, item.content)

    return h.article
      .class(
        spotlight
          ? 'content-detail spotlight-detail mx-auto px-4 pb-32 pt-6'
          : 'content-detail mx-auto max-w-5xl px-4 pb-32 pt-6',
      )
      .children(
        kind === 'editorial' && item.draft && DraftNotice(h, item.slug),
        showMasthead && ContentMasthead(h, item, kind, presentation?.banner ?? null),
        showMasthead &&
          (track !== null || h.props.hasActions) &&
          h.div
            .class('mt-8 flex items-center gap-2')
            .children(
              track && PlaybackControls(h, { props: { track, enqueue: true } }),
              h.slots.actions,
            ),
        showMasthead &&
          item.description &&
          h.p
            .class('mt-6 max-w-prose text-base leading-relaxed text-foreground/80')
            .children(item.description),
        showMasthead && ContentMeta(h, item),
        h.div.class(spotlight ? 'spotlight-body mt-4' : 'mt-10 max-w-prose').children(
          spotlight
            ? spotlightView(h, spotlight, {
                at: model.at,
                seen: model.seen,
                direction: model.direction,
                onStep: (at) => ContentDetailPageMessage.SteppedSpotlight({ at }),
                onVideo: (video) => ContentDetailPageMessage.OpenedVideo({ video }),
                musicActions: (music) => {
                  const spotify = music.links.find((link) => link.platform === 'spotify')

                  return spotify
                    ? SpotlightSpotify(h, {
                        key: `${h.props.principalId ?? 'anonymous'}:${music.canonicalUrl}`,
                        props: {
                          url: spotify.url,
                          identity: h.props.principalId ?? 'anonymous',
                          onboarding: false,
                        },
                      })
                    : h.text('')
                },
                onboarding: SpotlightSpotify(h, {
                  key: `${h.props.principalId ?? 'anonymous'}:onboarding`,
                  props: {
                    url: 'spotify:onboarding',
                    identity: h.props.principalId ?? 'anonymous',
                    onboarding: true,
                  },
                }),
                endArtwork: item.imageUrl
                  ? artwork(
                      h,
                      item.imageUrl,
                      `Record mosaic for ${item.title}`,
                      '160px',
                      false,
                      'spotlight-end-artwork',
                    )
                  : undefined,
              })
            : body,
          spotlight && h.el('noscript').children(richContentView(h, spotlight)),
        ),
        (showMasthead || model.at === 'end') &&
          (kind === 'mixes' || kind === 'editorial') &&
          EmailUpdatesInvite(h),
        Dialog(h, {
          props: { open: model.video !== null },
          onEmit: {
            RequestedClose: () => ContentDetailPageMessage.RequestedCloseVideoDialog(),
            RequestedOpen: () => undefined,
            Settled: () => undefined,
          },
          view: (dialog) =>
            dialog.portal(h.dialog)?.children(
              dialog.backdrop(h.div)?.class('fixed inset-0 bg-background/80 backdrop-blur-sm'),
              dialog
                .viewport(h.div)
                .class('fixed inset-0 grid place-items-center p-4')
                .children(
                  dialog
                    .popup(h.div)
                    .class('w-full max-w-5xl rounded-sm border border-border bg-background p-4')
                    .children(
                      dialog
                        .title(h.h2)
                        .class('sr-only')
                        .children(model.video?.title ?? 'Video'),
                      dialog
                        .close(h.button)
                        .attr('type', 'button')
                        .attr('aria-label', 'Close video')
                        .children('Close'),
                      model.video &&
                        h.iframe
                          .attr('src', model.video.embedUrl)
                          .attr('title', model.video.title)
                          .attr('allow', 'autoplay; encrypted-media; picture-in-picture')
                          .attr('allowfullscreen', '')
                          .class('aspect-video w-full border-0'),
                      model.video &&
                        h.a
                          .attr('href', model.video.canonicalUrl)
                          .attr('target', '_blank')
                          .attr('rel', 'noopener noreferrer')
                          .children('Open original video'),
                    ),
                ),
            ) ?? h.text(''),
        }),
      )
  },
})

export const ContentDetailPage = ContentDetailPageNoDeps.pipe(
  Component.provide(SaveSpotlightProgress.layer),
)
