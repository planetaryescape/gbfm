import type { McpScope } from '@gbfm/core/editorial-mcp'

import { appIdentity, connectionDocument, escape } from './document'
import type { ConsentState } from './domain'
import { icons } from './icons'

const expandedScopeLabels: Record<
  Exclude<McpScope, 'posts:read' | 'drafts:write' | 'offline_access'>,
  string
> = {
  'catalogue:read': 'Read public music catalogue information',
  'catalogue:write': 'Create and edit shared catalogue records (admin only)',
  'catalogue:import': 'Import music and read your import status (admin only)',
  'catalogue:propose': 'Submit your own catalogue correction proposals',
  'catalogue:inspect': 'Inspect internal catalogue quality evidence (admin only)',
  'catalogue:repair': 'Repair shared catalogue identity conflicts (admin only)',
  'content:read': 'Read published public content',
  'providers:read': 'Perform explicitly requested, bounded external provider reads',
  'playlists:write': 'Create and edit shared GBFM playlists (admin only)',
  'playlists:publish': 'Publish or unpublish GBFM playlists (admin only)',
  'listening:read': 'Read your saved listening, collections and private notes',
  'listening:write': 'Save and edit your listening, collections and notes',
  'listening:publish': 'Change listening visibility; public listening also exposes its notes',
  'favorites:read': 'Read your favorites',
  'favorites:write': 'Set or remove your favorites',
  'subscriptions:read': 'Read your subscriptions',
  'subscriptions:write': 'Set or remove your subscriptions',
  'reminders:read': 'Read your reminders',
  'reminders:write':
    'Schedule, reschedule or cancel your reminders, including reminder emails to you',
  'creator:read': 'Read your authored creator content, including private content',
  'creator:write': 'Edit your authored creator content',
  'micros:publish': 'Publish micro posts and replies as you; no announcements',
  'assets:read': 'Select public or your own authorized artwork',
  'assets:upload': 'Upload files for your authorized content',
  'content:publish': 'Publish or unpublish your authored content',
  'content:delete': 'Delete your authored content',
  'admin:read': 'Read aggregate admin counts, not user details or emails',
}

const scopeLabel = (scope: McpScope) => {
  if (scope === 'posts:read')
    return `${icons.eye}<span>Read your posts, including drafts and private posts</span>`

  if (scope === 'drafts:write')
    return `${icons.eye}<span>Create and edit your own unpublished editorial drafts</span>`

  if (scope === 'offline_access')
    return `${icons.refresh}<span>Stay connected until you disconnect it</span>`

  return `${icons.eye}<span>${escape(expandedScopeLabels[scope])}</span>`
}

export const consentDocument = ({
  clientName: name,
  continuation: { query, scopes },
  account,
}: typeof ConsentState.cases.Verified.Type) => {
  const callback = new URL(new URLSearchParams(query).get('redirect_uri') ?? '')
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(callback.hostname)
  const writes = scopes.includes('drafts:write')

  const expanded = scopes.some(
    (scope) => !['posts:read', 'drafts:write', 'offline_access'].includes(scope),
  )

  const destination = ['http:', 'https:'].includes(callback.protocol)
    ? callback.host
    : callback.protocol

  return connectionDocument(
    `Connect ${name}`,
    `${appIdentity(name)}<h1>Connect ${escape(name)}?</h1>
<div class="account"><p class="identity">${icons.user}<span><span class="muted">Signed in as</span> ${escape(account.name)} <span class="muted">(${escape(account.email)})</span></span></p><form method="post" action="/connect/gbfm/account"><input type="hidden" name="oauth_query" value="${escape(query)}"><button class="quiet" type="submit">Use another account <span class="muted">(signs you out)</span></button></form></div>
<section aria-labelledby="permissions"><h2 id="permissions">${expanded ? 'Requested permissions' : writes ? 'Read and draft-write access' : 'Read-only access'}</h2><ul>${scopes.map((scope) => `<li>${scopeLabel(scope)}</li>`).join('')}</ul>
<p class="muted row">${icons.lock}<span>${expanded ? 'Only the permissions listed above. Private content remains limited to its owner. New permissions require fresh consent.' : writes ? 'Cannot publish, delete, upload files or edit published posts.' : 'Cannot create, edit, publish or delete.'}</span></p>
<p class="destination row">${loopback ? icons.monitor : icons.globe}<span>Returns to <strong>${escape(destination)}</strong>${loopback ? ' <span class="muted">(app on this computer)</span>' : ''}</span></p></section>
<form class="actions" method="post" action="/connect/gbfm/consent"><input type="hidden" name="oauth_query" value="${escape(query)}"><button class="primary" name="decision" value="allow" type="submit">Allow connection</button><button name="decision" value="deny" type="submit">Cancel</button></form>
<small>App names are set by developers, not verified by Goosebumps FM. Revoke anytime in <a href="/dashboard/connections">Connections</a>.</small>`,
  )
}
