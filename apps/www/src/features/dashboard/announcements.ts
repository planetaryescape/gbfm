import { Command, Component, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { MAX_MIX_NOTIFICATION_RECIPIENTS, SendMixNotificationInput } from '@gbfm/api/email'
import { Effect, Layer, Predicate, Schema } from 'effect'

import { Principal } from '../../domain/principal'
import { DashboardDocument } from './document'
import { plural } from './formatting'
import { Notice } from './presentation'
import { DashboardService, DashboardServiceLive, ReadDashboard } from './service'

export const AnnouncementMessage = UiSchema.TaggedEnum({
  UpdatedMix: { value: Schema.String },
  UpdatedAudience: { value: Schema.String },
  UpdatedAddresses: { value: Schema.String },
  ClickedReview: {},
  ChangedReview: {},
  ClickedEdit: {},
  ToggledConfirmation: {},
  ClickedSend: {},
  SucceededSend: { notice: Schema.String },
  FailedSend: {},
})

export class SendAnnouncement extends Command.Service<SendAnnouncement>()(
  'dashboard/SendAnnouncement',
  {
    args: { payload: SendMixNotificationInput },
    success: AnnouncementMessage,
    mode: 'queue',
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* DashboardService

      return ({ payload }) =>
        service
          .request({
            path: '/api/email/send-mix-notification',
            method: 'POST',
            body: JSON.stringify(payload),
          })
          .pipe(
            Effect.map((document) =>
              document.emailSend
                ? AnnouncementMessage.SucceededSend({ notice: document.emailSend.message })
                : AnnouncementMessage.FailedSend(),
            ),
            Effect.catch(() => Effect.succeed(AnnouncementMessage.FailedSend())),
          )
    }),
  )
}

const AnnouncementDef = Html.component({
  name: 'DashboardAnnouncements',
  props: Schema.Struct({ principal: Principal, initialDocument: DashboardDocument }),
  model: Schema.Struct({
    mixSlug: Schema.String,
    audience: Schema.String,
    addresses: Schema.String,
    revision: Schema.Number,
    stage: Schema.Literals(['editing', 'checking', 'review', 'sending', 'complete', 'uncertain']),
    recipients: Schema.Array(Schema.String),
    excluded: Schema.Array(Schema.String),
    confirmed: Schema.Boolean,
    error: Schema.NullOr(Schema.String),
    notice: Schema.NullOr(Schema.String),
  }),
  message: AnnouncementMessage,
  restore: false,
  queries: {
    review: {
      query: ReadDashboard,
      args: ({ model, props }) =>
        model.revision > 0
          ? {
              path: '/api/email/mix-announcement-options',
              principalId: props.principal.id,
              revision: model.revision,
            }
          : undefined,
      onChange: () => AnnouncementMessage.ChangedReview(),
    },
  },
})

export const DashboardAnnouncementsNoDeps = AnnouncementDef.make({
  init: () => ({
    mixSlug: '',
    audience: 'all',
    addresses: '',
    revision: 0,
    stage: 'editing',
    recipients: [],
    excluded: [],
    confirmed: false,
    error: null,
    notice: null,
  }),
  update: AnnouncementDef.update(($, message) => {
    if (['sending', 'complete', 'uncertain'].includes($.model.stage)) {
      if (Predicate.isTagged(message, 'SucceededSend') && $.model.stage === 'sending')
        return $.evolve({ stage: 'complete', notice: message.notice })

      if (Predicate.isTagged(message, 'FailedSend') && $.model.stage === 'sending')
        return $.evolve({ stage: 'uncertain' })

      return $.model
    }

    return AnnouncementMessage.match(message, {
      UpdatedMix: (message) =>
        $.evolve({ mixSlug: message.value, stage: 'editing', error: null, confirmed: false }),
      UpdatedAudience: (message) =>
        $.evolve({
          audience: message.value,
          stage: 'editing',
          error: null,
          confirmed: false,
        }),
      UpdatedAddresses: (message) =>
        $.evolve({
          addresses: message.value,
          stage: 'editing',
          error: null,
          confirmed: false,
        }),
      ClickedEdit: () => $.evolve({ stage: 'editing', confirmed: false }),
      ToggledConfirmation: () => $.evolve({ confirmed: !$.model.confirmed }),
      ClickedReview: () =>
        $.model.stage !== 'editing' || !$.model.mixSlug
          ? $.model
          : $.evolve({ stage: 'checking', revision: $.model.revision + 1, error: null }),
      ChangedReview: () => {
        if ($.model.stage !== 'checking') return $.model
        const result = $.queries.review

        if (Predicate.isTagged(result, 'Failure'))
          return $.evolve({
            stage: 'editing',
            error: 'Could not check recipients. Nothing was sent. Try reviewing again.',
          })

        if (!Predicate.isTagged(result, 'Success') || !result.value.announcementOptions)
          return $.model
        const options = result.value.announcementOptions

        const requested = [
          ...new Set(
            $.model.addresses
              .split(/[\s,;]+/)
              .map((value) => value.trim().toLowerCase())
              .filter(Boolean),
          ),
        ]

        const eligible = new Set(options.recipients)

        const recipients =
          $.model.audience === 'all'
            ? options.recipients
            : requested.filter((email) => eligible.has(email))

        const excluded =
          $.model.audience === 'selected' ? requested.filter((email) => !eligible.has(email)) : []

        let error: string | null = null

        if (!options.mixes.some((mix) => mix.slug === $.model.mixSlug))
          error = 'This mix is no longer published. Choose another mix.'
        else if (
          $.model.audience === 'selected' &&
          requested.length > MAX_MIX_NOTIFICATION_RECIPIENTS
        )
          error = `Select up to ${MAX_MIX_NOTIFICATION_RECIPIENTS} addresses per send.`
        else if (recipients.length === 0)
          error = 'No eligible recipients. Choose subscribed listeners who allow mix updates.'

        return $.evolve({
          recipients,
          excluded,
          confirmed: false,
          error,
          stage: error ? 'editing' : 'review',
        })
      },

      ClickedSend: () => {
        if (
          $.model.stage !== 'review' ||
          !$.model.confirmed ||
          !$.model.recipients.length ||
          $.props.principal.role !== 'admin'
        )
          return $.model

        const payload =
          $.model.audience === 'selected'
            ? { mixSlug: $.model.mixSlug, recipients: $.model.recipients }
            : { mixSlug: $.model.mixSlug }

        return $.evolve({ stage: 'sending', error: null }).run(SendAnnouncement.make({ payload }))
      },

      SucceededSend: () => $.model,
      FailedSend: () => $.model,
    })
  }),
  view: (h, model) => {
    const options = Predicate.isTagged(h.queries.review, 'Success')
      ? h.queries.review.value.announcementOptions
      : h.props.initialDocument.announcementOptions

    if (model.stage === 'complete' || model.stage === 'uncertain')
      return h.section
        .class('dashboard-panel')
        .children(
          h.h2(
            model.stage === 'complete'
              ? 'Send finished'
              : 'Check delivery history before sending again',
          ),
          Notice(h, model.notice),
          model.stage === 'uncertain'
            ? h.p(
                'The result is uncertain. Some or all emails may have been sent. Do not repeat this send before checking delivery history.',
              )
            : undefined,
          h.a.attr('href', '/dashboard/email-logs').children('View email history'),
        )
    const reviewing = model.stage === 'review' || model.stage === 'sending'

    return h.section.class('dashboard-form').children(
      h.p('Choose the music, check the audience, then send.'),
      Notice(h, model.error, true),
      !reviewing
        ? [
            h.label.children(
              'Mix',
              h.select
                .attr('name', 'mixSlug')
                .disabled(model.stage === 'checking')
                .value(model.mixSlug)
                .on('change', ({ value }) => AnnouncementMessage.UpdatedMix({ value }))
                .children(
                  h.option.attr('value', '').children('Choose a published mix'),
                  options?.mixes.map((mix) => h.option.attr('value', mix.slug).children(mix.title)),
                ),
            ),
            h.label.children(
              'Audience',
              h.select
                .value(model.audience)
                .on('change', ({ value }) => AnnouncementMessage.UpdatedAudience({ value }))
                .children(
                  h.option.attr('value', 'all').children('All eligible subscribers'),
                  h.option.attr('value', 'selected').children('Selected addresses'),
                ),
            ),
            model.audience === 'selected'
              ? h.label.children(
                  'Addresses',
                  h.textarea
                    .value(model.addresses)
                    .on('input', ({ value }) => AnnouncementMessage.UpdatedAddresses({ value })),
                )
              : undefined,
            h.button
              .disabled(model.stage === 'checking')
              .on('click', AnnouncementMessage.ClickedReview())
              .children(model.stage === 'checking' ? 'Checking recipients…' : 'Review recipients'),
          ]
        : [
            h.h2('Review announcement'),
            h.p(plural(model.recipients.length, 'eligible recipient')),
            h.ul.children(model.recipients.map((email) => h.li(email))),
            model.excluded.length
              ? h.details.children(
                  h.summary(
                    plural(model.excluded.length, 'excluded address', 'excluded addresses'),
                  ),
                  h.ul.children(model.excluded.map((email) => h.li(email))),
                )
              : undefined,
            h.label.children(
              h.input
                .attr('type', 'checkbox')
                .checked(model.confirmed)
                .disabled(model.stage === 'sending')
                .on('click', AnnouncementMessage.ToggledConfirmation()),
              'I have checked the mix and recipient list.',
            ),
            h.button
              .disabled(model.stage === 'sending' || !model.confirmed)
              .on('click', AnnouncementMessage.ClickedSend())
              .children(model.stage === 'sending' ? 'Sending…' : 'Send announcement'),
            h.button
              .disabled(model.stage === 'sending')
              .on('click', AnnouncementMessage.ClickedEdit())
              .children('Back to editing'),
          ],
    )
  },
})

export const DashboardAnnouncements = DashboardAnnouncementsNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(ReadDashboard.layer, SendAnnouncement.layer).pipe(
      Layer.provide(DashboardServiceLive),
    ),
  ),
)
