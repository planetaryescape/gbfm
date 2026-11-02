import { Match } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'
import { defineView } from 'foldkit/submodel'

import type { Theme } from '../../theme'
import { collection } from './collection'
import { Message } from './message'
import type { Model } from './model'
import { dashboardHeader, sectionHref, sectionLabel, subTabs } from './navigation'
import { adminHub } from './page/admin'
import * as ApiKeys from './page/api-keys'
import { catalogView, entityRoute } from './page/catalog'
import { historyView, subscribersView } from './page/comms'
import { contentListView, isContentList } from './page/content'
import * as Emails from './page/emails'
import * as Playlists from './page/playlists'
import { searchView } from './page/search'
import * as Sessions from './page/sessions'
import * as Shows from './page/shows'
import { telemetryView } from './page/telemetry'
import { usersView } from './page/users'
import { isAdminSection } from './section'
import { pageHeader } from './ui'

export interface ViewInputs {
  readonly role: Model['principal']['role']
  readonly url: string
}

const input = (h: HtmlBuilder<Message>, model: Model, name: string, label: string, type = 'text') =>
  h.label(
    [],
    [
      label,
      h.input([
        h.Type(type),
        h.Value(model.fields[name] ?? ''),
        h.OnInput((value) => Message.FieldChanged({ name, value })),
      ]),
    ],
  )

const toggle = (h: HtmlBuilder<Message>, model: Model, name: string, label: string) =>
  h.label(
    [h.Class('dashboard-toggle')],
    [
      h.span([], [label]),
      h.input([
        h.Type('checkbox'),
        h.Checked(model.toggles[name] ?? false),
        h.OnClick(Message.ToggleChanged({ name, value: !(model.toggles[name] ?? false) })),
      ]),
    ],
  )

const profile = (model: Model, h: HtmlBuilder<Message>) =>
  h.section(
    [h.Class('dashboard-panel dashboard-form')],
    [
      input(h, model, 'username', 'Username'),
      input(h, model, 'email', 'Email', 'email'),
      h.label(
        [],
        [
          'Bio',
          h.textarea([
            h.Value(model.fields.bio ?? ''),
            h.Rows(6),
            h.OnInput((value) => Message.FieldChanged({ name: 'bio', value })),
          ]),
        ],
      ),
      h.button(
        [
          h.Class('dashboard-button-primary'),
          h.OnClick(Message.SaveProfile()),
          h.Disabled(model.phase === 'saving'),
        ],
        [model.phase === 'saving' ? 'Saving…' : 'Save profile'],
      ),
    ],
  )

const contentTypes = [
  { section: 'all/mixes', label: 'Mixes' },
  { section: 'all/tweets', label: 'Tweets' },
  { section: 'all/editorial', label: 'Editorial' },
]

const contentTypeTabs = (h: HtmlBuilder<Message>, section: string) =>
  subTabs(
    h,
    'Content types',
    contentTypes.map((type) => ({
      href: sectionHref(type.section),
      label: type.label,
      current: type.section === section,
    })),
  )

const featuredMixStatus = (model: Model) =>
  model.fields.unavailableTitle
    ? `Current selection: ${model.fields.unavailableTitle} (unpublished). The newest published mix is shown until you choose another.`
    : `Current selection: ${model.rows.find((row) => row.id === model.fields.savedMixId)?.title ?? 'Automatic, newest published mix'}`

const featuredMix = (model: Model, h: HtmlBuilder<Message>) =>
  h.section(
    [h.Class('admin-page')],
    [
      pageHeader(h, 'Choose the mix shown on the homepage. Only published mixes can be featured.'),
      h.div(
        [h.Class('dashboard-panel dashboard-form')],
        [
          h.p([h.Role('status')], [featuredMixStatus(model)]),
          h.label(
            [],
            [
              'Featured mix',
              h.select(
                [
                  h.Value(model.fields.mixId ?? ''),
                  h.Disabled(model.phase === 'saving'),
                  h.OnChange((value) => Message.FieldChanged({ name: 'mixId', value })),
                ],
                [
                  h.option([h.Value('')], ['Automatic (newest mix)']),
                  model.fields.unavailableTitle && model.fields.savedMixId
                    ? h.option(
                        [h.Value(model.fields.savedMixId), h.Disabled(true)],
                        [`${model.fields.unavailableTitle} (unpublished)`],
                      )
                    : h.empty,
                  ...model.rows.map((row) => h.option([h.Value(row.id)], [row.title])),
                ],
              ),
            ],
          ),
          h.p(
            [],
            [
              'If the selected mix is unpublished or deleted, the newest published mix appears instead.',
            ],
          ),
          model.error ? h.p([h.Role('alert')], [model.error]) : h.empty,
          h.button(
            [
              h.Class('dashboard-button-primary'),
              h.Disabled(
                model.phase === 'saving' || model.fields.mixId === model.fields.savedMixId,
              ),
              h.OnClick(Message.SaveFeaturedMix()),
            ],
            [model.phase === 'saving' ? 'Saving…' : 'Save featured mix'],
          ),
        ],
      ),
    ],
  )

const preferences = (model: Model, h: HtmlBuilder<Message>) =>
  h.section(
    [h.Class('dashboard-panel')],
    [
      toggle(h, model, 'mixReleaseEnabled', 'New mix and show updates'),
      toggle(h, model, 'promotionalEnabled', 'Promotional emails'),
      toggle(h, model, 'systemEnabled', 'System notifications'),
      toggle(h, model, 'globalUnsubscribe', 'Unsubscribe from all non-essential email'),
      h.button(
        [
          h.Class('dashboard-button-primary'),
          h.OnClick(Message.SaveEmailPreferences()),
          h.Disabled(model.phase === 'saving'),
        ],
        ['Save email preferences'],
      ),
    ],
  )

const player = (model: Model, h: HtmlBuilder<Message>) =>
  h.section(
    [h.Class('admin-page')],
    [
      pageHeader(h, 'Player settings are stored on this device.'),
      h.div(
        [h.Class('dashboard-panel')],
        [
          toggle(h, model, 'continueQueue', 'Continue through queue'),
          toggle(h, model, 'restorePosition', 'Restore listening position'),
          h.button(
            [
              h.Class('dashboard-button-primary'),
              h.OnClick(Message.SavePlayerPreferences()),
              h.Disabled(model.phase === 'saving'),
            ],
            [model.phase === 'saving' ? 'Saving…' : 'Save player preferences'],
          ),
        ],
      ),
    ],
  )

const themes: ReadonlyArray<{
  readonly theme: Theme
  readonly label: string
  readonly hint: string
}> = [
  { theme: 'light', label: 'Light', hint: 'Always use the light interface' },
  { theme: 'dark', label: 'Dark', hint: 'Always use the dark interface' },
  { theme: 'system', label: 'System', hint: 'Follow your device preference' },
]

const appearance = (model: Model, h: HtmlBuilder<Message>) =>
  h.section(
    [h.Class('admin-page')],
    [
      pageHeader(h, 'Choose how gbfm looks on this device.'),
      h.div(
        [h.Class('appearance-options')],
        themes.map(({ theme, label, hint }) =>
          h.button(
            [
              h.AriaPressed(String((model.fields.theme ?? 'system') === theme)),
              h.OnClick(Message.ThemeSelected({ theme })),
            ],
            [h.strong([], [label]), h.span([], [hint])],
          ),
        ),
      ),
    ],
  )

export const view = defineView<Model, typeof Message.Type, ViewInputs>((model, inputs, h) => {
  const role = inputs.role

  const spotify = h.section(
    [h.Class(model.section === 'spotify-callback' ? 'page prose' : 'dashboard-panel')],
    [
      model.section === 'spotify-callback' ? h.h2([], ['Spotify connection']) : h.empty,
      h.p([], ['Connect Spotify to play and queue tracks from music cards.']),
      model.phase === 'loading' ? h.p([h.Role('status')], ['Connecting Spotify…']) : h.empty,
      model.error ? h.p([h.Role('alert')], [model.error]) : h.empty,
      model.spotify.connected ? h.p([], [`Connected as ${model.spotify.name}`]) : h.empty,
      model.section === 'spotify-callback'
        ? h.a([h.Href('/dashboard/integrations')], ['Back to integrations'])
        : h.div(
            [],
            [
              h.button(
                [
                  h.Disabled(model.phase === 'loading'),
                  h.OnClick(
                    Message.SpotifyRequested({
                      action: model.spotify.connected ? 'disconnect' : 'connect',
                    }),
                  ),
                ],
                [model.spotify.connected ? 'Disconnect Spotify' : 'Connect Spotify'],
              ),
              h.button(
                [
                  h.Disabled(model.phase === 'loading'),
                  h.OnClick(Message.SpotifyRequested({ action: 'status' })),
                ],
                ['Refresh session'],
              ),
            ],
          ),
    ],
  )

  if (model.section === 'spotify-callback') return spotify

  const entity = entityRoute(model.section)

  const shell = (heading: string, body: ReturnType<typeof h.div>) =>
    h.div(
      [h.Class('gbfm-dashboard')],
      [
        dashboardHeader(h, model.section, role),
        h.section(
          [h.Class('dashboard-content')],
          [h.header([h.Class('dashboard-heading')], [h.h1([], [heading])]), body],
        ),
      ],
    )

  if (isAdminSection(model.section) && role !== 'admin')
    return shell(
      'Administrator access required',
      h.p(
        [h.Class('dashboard-forbidden')],
        [
          'This area is not available to your account. ',
          h.a([h.Href('/dashboard')], ['Go to your dashboard']),
        ],
      ),
    )

  if (model.section === 'api-keys')
    return shell(
      'API keys',
      h.submodel({
        slotId: 'api-keys',
        view: ApiKeys.view,
        model: model.apiKeys,
        viewInputs: { role, userId: model.principal.id },
        toParentMessage: (message) => Message.GotApiKeyMessage({ message }),
      }),
    )

  const content =
    model.section === 'emails' && model.phase === 'ready'
      ? h.submodel({
          slotId: 'emails',
          view: Emails.view,
          model: model.emails,
          toParentMessage: (message) => Message.GotEmailMessage({ message }),
        })
      : model.section === 'newsletter' && model.phase === 'ready'
        ? subscribersView(model, h)
        : model.section === 'email-logs' && model.phase !== 'error'
          ? historyView(model, inputs.url, h)
          : model.section === 'users'
            ? usersView(
                model.users,
                model.fields.search ?? '',
                Number(model.fields.offset ?? '0'),
                new URL(inputs.url).searchParams.get('notice') ?? '',
              )
            : model.section === 'sessions'
              ? h.submodel({
                  slotId: 'sessions',
                  view: Sessions.view,
                  model: model.sessions,
                  toParentMessage: (message) => Message.GotSessionMessage({ message }),
                })
              : model.section === 'integrations'
                ? spotify
                : model.section === 'playlists' && model.phase === 'ready'
                  ? h.submodel({
                      slotId: 'playlists',
                      view: Playlists.view,
                      model: model.playlists,
                      toParentMessage: (message) => Message.GotPlaylistMessage({ message }),
                    })
                  : isContentList(model.section)
                    ? contentListView(model, h)
                    : (model.section === 'music' || entity) && model.phase !== 'loading'
                      ? catalogView(model, h, Message)
                      : model.section === 'search'
                        ? searchView(model, inputs.url, h)
                        : model.phase === 'loading'
                          ? h.p([h.Class('dashboard-state')], ['Loading…'])
                          : model.section === 'featured-mix' &&
                              model.fields.savedMixId !== undefined
                            ? featuredMix(model, h)
                            : model.phase === 'error'
                              ? h.div(
                                  [h.Class('dashboard-state dashboard-error'), h.Role('alert')],
                                  [
                                    h.p(
                                      [],
                                      [model.error ?? 'Could not load this dashboard section.'],
                                    ),
                                    h.button([h.OnClick(Message.LoadRequested())], ['Try again']),
                                  ],
                                )
                              : model.section === 'frontend-errors'
                                ? telemetryView(h, model.telemetry)
                                : model.section === 'shows'
                                  ? h.submodel({
                                      slotId: 'shows',
                                      view: Shows.view,
                                      model: model.shows,
                                      toParentMessage: (message) =>
                                        Message.GotShowMessage({ message }),
                                    })
                                  : Match.value(model.section).pipe(
                                      Match.when('profile', () => profile(model, h)),
                                      Match.when('email', () => preferences(model, h)),
                                      Match.when('player', () => player(model, h)),
                                      Match.when('appearance', () => appearance(model, h)),
                                      Match.when('admin', () => adminHub(h, model.rows)),
                                      Match.orElse(() => collection(model, h)),
                                    )

  return shell(
    model.section === 'overview'
      ? 'Your dashboard'
      : entity
        ? `Edit ${entity.kind}`
        : sectionLabel(model.section, role),
    model.section.startsWith('all/')
      ? h.div([h.Class('dashboard-stack')], [contentTypeTabs(h, model.section), content])
      : content,
  )
})
