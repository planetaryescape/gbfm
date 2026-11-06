import { appIdentity, connectionDocument, escape } from './document'
import type { ConsentState } from './domain'
import { icons } from './icons'

const scopeLabel = (scope: string) =>
  scope === 'posts:read'
    ? `${icons.eye}<span>Read your posts, including drafts and private posts</span>`
    : `${icons.refresh}<span>Stay connected until you disconnect it</span>`

export const consentDocument = ({
  clientName: name,
  continuation: { query, scopes },
  account,
}: typeof ConsentState.cases.Verified.Type) => {
  const callback = new URL(new URLSearchParams(query).get('redirect_uri') ?? '')
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(callback.hostname)

  const destination = ['http:', 'https:'].includes(callback.protocol)
    ? callback.host
    : callback.protocol

  return connectionDocument(
    `Connect ${name}`,
    `${appIdentity(name)}<h1>Connect ${escape(name)}?</h1>
<div class="account"><p class="identity">${icons.user}<span><span class="muted">Signed in as</span> ${escape(account.name)} <span class="muted">(${escape(account.email)})</span></span></p><form method="post" action="/connect/gbfm/account"><input type="hidden" name="oauth_query" value="${escape(query)}"><button class="quiet" type="submit">Use another account <span class="muted">(signs you out)</span></button></form></div>
<section aria-labelledby="permissions"><h2 id="permissions">Read-only access</h2><ul>${scopes.map((scope) => `<li>${scopeLabel(scope)}</li>`).join('')}</ul>
<p class="muted row">${icons.lock}<span>Cannot create, edit, publish or delete.</span></p>
<p class="destination row">${loopback ? icons.monitor : icons.globe}<span>Returns to <strong>${escape(destination)}</strong>${loopback ? ' <span class="muted">(app on this computer)</span>' : ''}</span></p></section>
<form class="actions" method="post" action="/connect/gbfm/consent"><input type="hidden" name="oauth_query" value="${escape(query)}"><button class="primary" name="decision" value="allow" type="submit">Allow connection</button><button name="decision" value="deny" type="submit">Cancel</button></form>
<small>App names are set by developers, not verified by Goosebumps FM. Revoke anytime in <a href="/dashboard/connections">Connections</a>.</small>`,
  )
}
