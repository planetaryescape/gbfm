import { Match } from 'effect'
import { Command, type Update } from 'foldkit'

import {
  ApplyTheme,
  Load,
  LoadCatalogLinks,
  SavePlayerPreferences,
  type Services,
  SpotifyRequest,
  Write,
  WriteCatalog,
} from './command'
import { type CatalogOperation, Message } from './message'
import type { Model } from './model'
import * as ApiKeys from './page/api-keys'
import { entityRoute } from './page/catalog'
import * as Connections from './page/connections'
import * as Emails from './page/emails'
import * as Playlists from './page/playlists'
import * as Sessions from './page/sessions'
import * as Shows from './page/shows'
import { endpointFor } from './section'

const writeCatalog = (
  model: Model,
  operation: typeof CatalogOperation.Type,
  linkId = '',
): Update.Return<Model, Message, Services> => {
  const entity = entityRoute(model.section)

  if (
    model.principal.role !== 'admin' ||
    model.phase === 'saving' ||
    (entity && model.fields.id !== entity.id) ||
    (!entity && operation !== 'create-label')
  )
    return { model }

  return {
    model: {
      ...model,
      phase: 'saving',
      error: null,
      catalogRevision: model.catalogRevision + 1,
      catalogNotice: '',
    },
    commands: [
      WriteCatalog({
        operation,
        kind: entity?.kind ?? 'label',
        id: entity?.id ?? '',
        fields: model.fields,
        linkId,
      }),
    ],
  }
}

export const update = (model: Model, message: Message): Update.Return<Model, Message, Services> =>
  Message.match<Update.Return<Model, Message, Services>>(message, {
    GotApiKeyMessage: ({ message }) => {
      if (model.section !== 'api-keys') return { model }
      const child = ApiKeys.update(model.apiKeys, message)

      return {
        model: { ...model, apiKeys: child.model },
        commands: Command.mapMessages(child.commands ?? [], (message) =>
          Message.GotApiKeyMessage({ message }),
        ),
      }
    },
    GotEmailMessage: ({ message }) => {
      if (model.principal.role !== 'admin' || model.section !== 'emails') return { model }
      const child = Emails.update(model.emails, message)

      return {
        model: { ...model, emails: child.model },
        commands: Command.mapMessages(child.commands ?? [], (message) =>
          Message.GotEmailMessage({ message }),
        ),
      }
    },
    SaveFeaturedMix: () => {
      if (
        model.principal.role !== 'admin' ||
        model.section !== 'featured-mix' ||
        (model.phase !== 'ready' && model.phase !== 'error') ||
        model.fields.savedMixId === undefined
      )
        return { model }

      return {
        model: { ...model, phase: 'saving', error: null },
        commands: [
          Write({
            path: '/api/admin/featured-mix',
            method: 'PUT',
            body: JSON.stringify({ mixId: model.fields.mixId || null }),
          }),
        ],
      }
    },
    GotPlaylistMessage: ({ message }) => {
      if (model.principal.role !== 'admin' || model.section !== 'playlists') return { model }
      const child = Playlists.update(model.playlists, message)

      return {
        model: { ...model, playlists: child.model },
        commands: Command.mapMessages(child.commands ?? [], (message) =>
          Message.GotPlaylistMessage({ message }),
        ),
      }
    },
    SaveCatalogEntity: () => writeCatalog(model, 'save'),
    DeleteCatalogEntity: () => writeCatalog(model, 'delete'),
    AddCatalogLink: () => writeCatalog(model, 'add-link'),
    DeleteCatalogLink: ({ id }) =>
      model.rows.some((row) => row.id === id) ? writeCatalog(model, 'remove-link', id) : { model },
    CreateLabel: () =>
      model.section === 'music' ? writeCatalog(model, 'create-label') : { model },
    CatalogLinksLoaded: ({ rows, revision }) =>
      revision !== model.catalogRevision
        ? { model }
        : {
            model: { ...model, rows, fields: { ...model.fields, linksError: '' } },
          },
    CatalogLinksFailed: ({ revision }) =>
      revision !== model.catalogRevision
        ? { model }
        : {
            model: {
              ...model,
              fields: { ...model.fields, linksError: 'Source links are unavailable.' },
            },
          },
    CatalogCompleted: ({ operation }) => {
      if (operation === 'delete')
        return { model: { ...model, phase: 'ready', fields: { deleted: 'true' }, rows: [] } }

      if (operation === 'create-label')
        return {
          model: { ...model, phase: 'loading' },
          commands: [Load({ path: '/api/music/labels/manage' })],
        }
      const entity = entityRoute(model.section)

      if (!entity) return { model }

      return operation === 'save'
        ? {
            model: { ...model, phase: 'loading', catalogNotice: 'Entity saved.' },
            commands: [Load({ path: entity.path })],
          }
        : {
            model: { ...model, phase: 'ready', fields: { ...model.fields, linkUrl: '' } },
            commands: [
              LoadCatalogLinks({
                kind: entity.kind,
                id: entity.id,
                revision: model.catalogRevision,
              }),
            ],
          }
    },
    GotShowMessage: ({ message }) => {
      if (model.principal.role !== 'admin' || model.section !== 'shows') return { model }
      const child = Shows.update(model.shows, message)

      return {
        model: { ...model, shows: child.model },
        commands: Command.mapMessages(child.commands ?? [], (message) =>
          Message.GotShowMessage({ message }),
        ),
      }
    },
    GotSessionMessage: ({ message }) => {
      if (model.principal.role !== 'admin' || model.section !== 'sessions') return { model }
      const child = Sessions.update(model.sessions, message)

      return {
        model: { ...model, sessions: child.model },
        commands: Command.mapMessages(child.commands ?? [], (message) =>
          Message.GotSessionMessage({ message }),
        ),
      }
    },
    SpotifyRequested: ({ action }) => ({
      model: { ...model, phase: 'loading', error: null },
      commands: [SpotifyRequest({ action })],
    }),
    SpotifyLoaded: ({ status }) => ({
      model: { ...model, phase: 'ready', spotify: status, error: null },
    }),
    ThemeSelected: ({ theme }) => ({ model, commands: [ApplyTheme({ theme })] }),
    ThemeRestored: ({ theme }) => ({ model: { ...model, fields: { ...model.fields, theme } } }),
    PlayerPreferencesLoaded: ({ preferences }) => ({
      model: { ...model, phase: 'ready', toggles: preferences },
    }),
    LoadRequested: () => {
      if (model.section === 'connections')
        return {
          model: { ...model, phase: 'loading', error: null, connections: Connections.initialModel },
          commands: [Load({ path: '/api/user/mcp-connections' })],
        }

      if (model.section === 'integrations')
        return {
          model: { ...model, phase: 'loading', error: null },
          commands: [SpotifyRequest({ action: 'status' })],
        }
      const path = endpointFor(model.section, new URLSearchParams(model.fields))

      return path
        ? { model: { ...model, phase: 'loading', error: null }, commands: [Load({ path })] }
        : { model }
    },
    Loaded: ({ document }) => {
      const entity = entityRoute(model.section)

      return {
        model: {
          ...model,
          phase: 'ready',
          rows: document.rows,
          connections: document.connections
            ? Connections.Model.cases.Ready.make({ connections: document.connections })
            : model.section === 'connections'
              ? Connections.Model.cases.Failed.make({ message: 'Connections are unavailable.' })
              : model.connections,
          pagination: document.pagination,
          fields: document.fields,
          toggles: document.toggles,
          telemetry: document.telemetry,
          users: document.users,
          subscribers: document.subscribers,
          emailLogs: document.emailLogs,
          emails: {
            ...Emails.initialModel,
            options: document.announcementOptions ?? Emails.initialModel.options,
          },
          shows: { ...Shows.initialModel, listing: document.shows },
          playlists: { ...Playlists.initialModel, listing: document.playlists ?? [] },
          error: null,
          catalogRevision: model.catalogRevision + 1,
        },
        commands: entity
          ? [
              LoadCatalogLinks({
                kind: entity.kind,
                id: entity.id,
                revision: model.catalogRevision + 1,
              }),
            ]
          : [],
      }
    },
    Failed: ({ message: error }) => ({
      model: {
        ...model,
        phase: 'error',
        error,
        connections:
          model.section === 'connections'
            ? Connections.Model.cases.Failed.make({ message: error })
            : model.connections,
      },
    }),
    FieldChanged: ({ name, value }) => ({
      model: { ...model, fields: { ...model.fields, [name]: value } },
    }),
    ToggleChanged: ({ name, value }) => ({
      model: { ...model, toggles: { ...model.toggles, [name]: value } },
    }),
    SaveProfile: () => ({
      model: { ...model, phase: 'saving' },
      commands: [
        Write({ path: '/api/user/profile', method: 'PATCH', body: JSON.stringify(model.fields) }),
      ],
    }),
    SaveEmailPreferences: () => ({
      model: { ...model, phase: 'saving' },
      commands: [
        Write({
          path: '/api/user/email-preferences',
          method: 'PATCH',
          body: JSON.stringify(model.toggles),
        }),
      ],
    }),
    SavePlayerPreferences: () => ({
      model: { ...model, phase: 'saving' },
      commands: [
        SavePlayerPreferences({
          preferences: {
            continueQueue: model.toggles.continueQueue ?? true,
            restorePosition: model.toggles.restorePosition ?? true,
          },
        }),
      ],
    }),
    DeleteRequested: ({ id }) => {
      const row = model.rows.find((item) => item.id === id)
      const actionId = row?.actionId

      if (!actionId) return { model }

      const path = Match.value(model.section).pipe(
        Match.when('reminders', () => `/api/music-reminders/${encodeURIComponent(actionId)}`),
        Match.when(
          'favorites',
          () => `/api/favorites/${actionId.split('/').map(encodeURIComponent).join('/')}`,
        ),
        Match.orElse(() => null),
      )

      return path
        ? {
            model: { ...model, phase: 'saving' },
            commands: [Write({ path, method: 'DELETE', body: '' })],
          }
        : { model }
    },
    Saved: () => {
      const path = endpointFor(model.section)

      return path
        ? { model: { ...model, phase: 'loading', error: null }, commands: [Load({ path })] }
        : { model: { ...model, phase: 'ready' } }
    },
  })
