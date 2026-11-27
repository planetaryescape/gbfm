import { Command, Component, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { PlayerPreferences } from '@gbfm/player'
import { Effect, Layer, Schema } from 'effect'

import { readTheme, saveTheme, Theme } from '../../theme'
import { DashboardDocument } from './document'
import { Field, Notice } from './presentation'
import { DashboardService, DashboardServiceLive } from './service'

const SettingsMessage = UiSchema.TaggedEnum({
  UpdatedField: { name: Schema.String, value: Schema.String },
  ToggledPreference: { name: Schema.String },
  ClickedSave: {},
  PickedTheme: { theme: Theme },
  RestoredDevice: { toggles: Schema.Record(Schema.String, Schema.Boolean), theme: Theme },
  SucceededSave: {},
  FailedSave: { message: Schema.String },
})

const SettingsModel = Schema.Struct({
  fields: Schema.Record(Schema.String, Schema.String),
  toggles: Schema.Record(Schema.String, Schema.Boolean),
  busy: Schema.Boolean,
  notice: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
})

class SaveSettings extends Command.Service<SaveSettings>()('dashboard/SaveSettings', {
  args: {
    section: Schema.String,
    fields: SettingsModel.fields.fields,
    toggles: SettingsModel.fields.toggles,
  },
  success: SettingsMessage,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* DashboardService

      return ({ section, fields, toggles }) =>
        Effect.gen(function* () {
          if (section === 'player') {
            const preferences = yield* Schema.decodeUnknownEffect(PlayerPreferences)(toggles)
            yield* service.writePlayerPreferences(preferences)
          } else {
            const path = section === 'email' ? '/api/user/email-preferences' : '/api/user/profile'
            yield* service.request({
              path,
              method: 'PATCH',
              body: JSON.stringify(section === 'email' ? toggles : fields),
            })
          }

          return SettingsMessage.SucceededSave()
        }).pipe(
          Effect.catch(() =>
            Effect.succeed(
              SettingsMessage.FailedSave({
                message: 'Could not save changes. Check the fields and try again.',
              }),
            ),
          ),
        )
    }),
  )
}

class RestoreDevice extends Command.Service<RestoreDevice>()('dashboard/RestoreDevice', {
  args: {},
  success: SettingsMessage,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* DashboardService

      return () =>
        service.readPlayerPreferences.pipe(
          Effect.map((toggles) => SettingsMessage.RestoredDevice({ toggles, theme: readTheme() })),
        )
    }),
  )
}

class ApplyTheme extends Command.Service<ApplyTheme>()('dashboard/ApplyTheme', {
  args: { theme: Theme },
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(({ theme }) =>
    Effect.sync(() => saveTheme(theme)).pipe(Effect.as(Component.noop)),
  )
}

const SettingsDef = Html.component({
  name: 'DashboardSettings',
  props: Schema.Struct({ section: Schema.String, initialDocument: DashboardDocument }),
  model: SettingsModel,
  message: SettingsMessage,
  restore: (model) => ({ ...model, busy: false, error: null, notice: null }),
})

export const DashboardSettingsNoDeps = SettingsDef.make({
  init: ($) =>
    $.set({
      fields: $.props.initialDocument.fields,
      toggles: $.props.initialDocument.toggles,
      busy: false,
      notice: null,
      error: null,
    }).run(
      ...($.props.section === 'player' || $.props.section === 'appearance'
        ? [RestoreDevice.make({})]
        : []),
    ),
  update: {
    UpdatedField: ($, message) =>
      $.evolve({ fields: { ...$.model.fields, [message.name]: message.value } }),
    ToggledPreference: ($, message) =>
      $.evolve({
        toggles: { ...$.model.toggles, [message.name]: !$.model.toggles[message.name] },
      }),
    ClickedSave: ($) =>
      $.model.busy
        ? $.model
        : $.evolve({ busy: true, notice: null, error: null }).run(
            SaveSettings.make({
              section: $.props.section,
              fields: $.model.fields,
              toggles: $.model.toggles,
            }),
          ),
    PickedTheme: ($, message) =>
      $.evolve({ fields: { ...$.model.fields, theme: message.theme } }).run(
        ApplyTheme.make({ theme: message.theme }),
      ),
    RestoredDevice: ($, message) =>
      $.evolve({
        toggles: message.toggles,
        fields: { ...$.model.fields, theme: message.theme },
      }),
    SucceededSave: ($) => $.evolve({ busy: false, notice: 'Changes saved.', error: null }),
    FailedSave: ($, message) => $.evolve({ busy: false, error: message.message }),
  },
  view: (h, model) => {
    const props = h.props

    if (props.section === 'appearance')
      return h.section.class('appearance-options').children(
        ['light', 'dark', 'system'].map((value) => {
          const theme = Schema.decodeUnknownSync(Theme)(value)

          return h.button
            .attr('type', 'button')
            .attr('aria-pressed', String(model.fields.theme === theme))
            .on('click', SettingsMessage.PickedTheme({ theme }))
            .children(theme)
        }),
      )

    const toggleLabels: Readonly<Record<string, string>> =
      props.section === 'player'
        ? { continueQueue: 'Continue through queue', restorePosition: 'Restore listening position' }
        : {
            mixReleaseEnabled: 'New mix and show updates',
            promotionalEnabled: 'Promotional emails',
            systemEnabled: 'System notifications',
            globalUnsubscribe: 'Unsubscribe from all non-essential email',
          }

    return h.section.class('dashboard-panel dashboard-form').children(
      props.section === 'profile'
        ? [
            Field(h, 'username', 'Username', model.fields.username ?? '', (value) =>
              SettingsMessage.UpdatedField({ name: 'username', value }),
            ),
            Field(
              h,
              'email',
              'Email',
              model.fields.email ?? '',
              (value) => SettingsMessage.UpdatedField({ name: 'email', value }),
              'email',
            ),
            h.label.children(
              'Bio',
              h.textarea
                .attr('name', 'bio')
                .value(model.fields.bio ?? '')
                .attr('rows', '6')
                .on('input', (event) =>
                  SettingsMessage.UpdatedField({ name: 'bio', value: event.value }),
                ),
            ),
          ]
        : Object.entries(toggleLabels).map(([name, label]) =>
            h.label.class('dashboard-toggle').children(
              h.span(label),
              h.input
                .attr('type', 'checkbox')
                .checked(model.toggles[name] ?? false)
                .on('click', SettingsMessage.ToggledPreference({ name })),
            ),
          ),
      Notice(h, model.error, true),
      Notice(h, model.notice),
      h.button
        .attr('type', 'button')
        .class('dashboard-button-primary')
        .disabled(model.busy)
        .on('click', SettingsMessage.ClickedSave())
        .children(model.busy ? 'Saving…' : 'Save changes'),
    )
  },
})

export const settingsOperationsLayer = Layer.mergeAll(
  SaveSettings.layer,
  RestoreDevice.layer,
  ApplyTheme.layer,
)

export const DashboardSettings = DashboardSettingsNoDeps.pipe(
  Component.provide(settingsOperationsLayer.pipe(Layer.provide(DashboardServiceLive))),
)
