import { Command, type Runtime } from 'foldkit'

import { disconnected } from '../../spotify/connection'
import {
  Load,
  RestorePlayerPreferences,
  RestoreTheme,
  type Services,
  SpotifyRequest,
} from './command'
import { Message } from './message'
import type { Model, Principal } from './model'
import * as ApiKeys from './page/api-keys'
import * as Connections from './page/connections'
import * as Emails from './page/emails'
import * as Playlists from './page/playlists'
import * as Sessions from './page/sessions'
import * as Shows from './page/shows'
import { endpointFor, isAdminSection } from './section'

export const initialModel = (section: string, principal: Principal): Model => ({
  section,
  principal,
  phase: 'loading',
  rows: [],
  fields: {},
  toggles: {},
  error: null,
  spotify: disconnected,
  emails: Emails.initialModel,
  sessions: Sessions.initialModel,
  shows: Shows.initialModel,
  playlists: Playlists.initialModel,
  apiKeys: ApiKeys.initialModel,
  connections: Connections.initialModel,
  catalogRevision: 0,
  catalogNotice: '',
})

export const init =
  (
    section: string,
    principal: Principal,
    query = new URLSearchParams(),
  ): Runtime.ApplicationInit<Model, Message, void, Services> =>
  () => {
    const model = {
      ...initialModel(section, principal),
      fields: section === 'email-logs' ? Object.fromEntries(query) : {},
    }

    const endpoint = endpointFor(section, query)

    if (isAdminSection(section) && principal.role !== 'admin')
      return { model: { ...model, phase: 'error', error: 'Administrator access required.' } }

    if (section === 'appearance')
      return { model: { ...model, phase: 'ready' }, commands: [RestoreTheme()] }

    if (section === 'player') return { model, commands: [RestorePlayerPreferences()] }

    if (section === 'api-keys')
      return {
        model: { ...model, phase: 'ready' },
        commands: Command.mapMessages([ApiKeys.Load({ offset: 0 })], (message) =>
          Message.GotApiKeyMessage({ message }),
        ),
      }

    if (section === 'integrations' || section === 'spotify-callback')
      return {
        model,
        commands: [
          SpotifyRequest({ action: section === 'integrations' ? 'status' : 'completeCallback' }),
        ],
      }

    return endpoint
      ? { model, commands: [Load({ path: endpoint })] }
      : { model: { ...model, phase: 'ready' } }
  }
