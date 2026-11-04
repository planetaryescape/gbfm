import { AddEntityLinkInput, CreateLabelInput } from '@gbfm/api/music'
import { PlayerPreferences } from '@gbfm/player'
import { Effect, Schema } from 'effect'
import { Command } from 'foldkit'

import { disconnected, SpotifyConnection } from '../../spotify/connection'
import { readTheme, saveTheme, Theme } from '../../theme'
import { CatalogOperation, Message } from './message'
import type * as ApiKeys from './page/api-keys'
import { catalogPayload, Kind } from './page/catalog'
import type * as Sessions from './page/sessions'
import { DashboardService } from './service'

export type Services =
  | DashboardService
  | SpotifyConnection
  | Sessions.SessionService
  | ApiKeys.KeyService

export const SpotifyRequest = Command.define('Spotify.Connection', {
  args: { action: Schema.Literals(['status', 'connect', 'disconnect', 'completeCallback']) },
  messages: [Message.SpotifyLoaded, Message.Failed],
  execute: ({ action }) =>
    SpotifyConnection.pipe(
      Effect.flatMap((service) => service[action]),
      Effect.map((status) => Message.SpotifyLoaded({ status: status ?? disconnected })),
      Effect.catch((error) => Effect.succeed(Message.Failed({ message: error.message }))),
    ),
})

export const RestoreTheme = Command.define('Appearance.Restore', {
  messages: [Message.ThemeRestored],
  execute: Effect.sync(() => Message.ThemeRestored({ theme: readTheme() })),
})

export const RestorePlayerPreferences = Command.define('PlayerPreferences.Restore', {
  messages: [Message.PlayerPreferencesLoaded],
  execute: DashboardService.pipe(
    Effect.flatMap((service) => service.readPlayerPreferences),
    Effect.map((preferences) => Message.PlayerPreferencesLoaded({ preferences })),
  ),
})

export const SavePlayerPreferences = Command.define('PlayerPreferences.Save', {
  args: { preferences: PlayerPreferences },
  messages: [Message.Saved, Message.Failed],
  execute: ({ preferences }) =>
    DashboardService.pipe(
      Effect.flatMap((service) => service.writePlayerPreferences(preferences)),
      Effect.as(Message.Saved()),
      Effect.catch((error) => Effect.succeed(Message.Failed({ message: error.message }))),
    ),
})

export const ApplyTheme = Command.define('Appearance.Apply', {
  args: { theme: Theme },
  messages: [Message.ThemeRestored],
  execute: ({ theme }) =>
    Effect.sync(() => {
      saveTheme(theme)

      return Message.ThemeRestored({ theme })
    }),
})

export const Load = Command.define('DashboardLoad', {
  args: { path: Schema.String },
  messages: [Message.Loaded, Message.Failed, Message.ConnectionsUnavailable],
  execute: ({ path }) =>
    DashboardService.pipe(
      Effect.flatMap((service) => service.request({ path })),
      Effect.map((document) => Message.Loaded({ document })),
      Effect.catch((error) =>
        Effect.succeed(
          path === '/api/user/mcp-connections' && [403, 503].includes(error.status ?? 0)
            ? Message.ConnectionsUnavailable()
            : Message.Failed({ message: error.message }),
        ),
      ),
    ),
})

export const LoadCatalogLinks = Command.define('Catalog.LoadLinks', {
  args: { kind: Kind, id: Schema.String, revision: Schema.Number },
  messages: [Message.CatalogLinksLoaded, Message.CatalogLinksFailed],
  execute: ({ kind, id, revision }) =>
    DashboardService.pipe(
      Effect.flatMap((service) =>
        service.request({ path: `/api/music/${kind}/${encodeURIComponent(id)}/links` }),
      ),
      Effect.map((document) => Message.CatalogLinksLoaded({ rows: document.rows, revision })),
      Effect.catch(() => Effect.succeed(Message.CatalogLinksFailed({ revision }))),
    ),
})

export const WriteCatalog = Command.define('Catalog.Write', {
  args: {
    operation: CatalogOperation,
    kind: Kind,
    id: Schema.String,
    fields: Schema.Record(Schema.String, Schema.String),
    linkId: Schema.String,
  },
  messages: [Message.CatalogCompleted, Message.Failed],
  execute: ({ operation, kind, id, fields, linkId }) =>
    Effect.gen(function* () {
      const service = yield* DashboardService
      const path = `/api/music/${kind}s/${encodeURIComponent(id)}`
      const links = `/api/music/${kind}/${encodeURIComponent(id)}/links`

      if (operation === 'save') {
        const body = yield* catalogPayload(kind, fields)
        yield* service.request({ path, method: 'PATCH', body })
      } else if (operation === 'delete') yield* service.request({ path, method: 'DELETE' })
      else if (operation === 'remove-link')
        yield* service.request({ path: `${links}/${encodeURIComponent(linkId)}`, method: 'DELETE' })
      else if (operation === 'add-link') {
        const payload = yield* Schema.decodeUnknownEffect(AddEntityLinkInput)({
          platform: fields.platform || 'spotify',
          url: fields.linkUrl,
          status: 'verified',
        })

        yield* service.request({ path: links, method: 'POST', body: JSON.stringify(payload) })
      } else {
        const payload = yield* Schema.decodeUnknownEffect(CreateLabelInput)({
          name: fields.name?.trim(),
          slug: fields.slug?.trim(),
          content: '',
        })

        yield* service.request({
          path: '/api/music/labels',
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }

      return Message.CatalogCompleted({ operation })
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(
          Message.Failed({
            message: 'Catalog action failed. Check the fields and your access, then retry.',
          }),
        ),
      ),
    ),
})

// Dashboard command arguments can contain account data. Parent telemetry must mark command spans private.
export const Write = Command.define('DashboardWrite', {
  args: {
    path: Schema.String,
    method: Schema.Literals(['PATCH', 'PUT', 'DELETE']),
    body: Schema.String,
  },
  messages: [Message.Saved, Message.Failed],
  execute: ({ path, method, body }) =>
    DashboardService.pipe(
      Effect.flatMap((service) => service.request({ path, method, body })),
      Effect.as(Message.Saved()),
      Effect.catch((error) => Effect.succeed(Message.Failed({ message: error.message }))),
    ),
})
