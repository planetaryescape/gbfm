import { connectionDocument, escape } from './document'
import type { ConsentState } from './domain'

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
    `<h1>Connect ${escape(name)}?</h1>
<p>Review this app’s access to your Goosebumps FM account.</p>
<div class="account"><p class="muted">Connecting as</p><p class="identity">${escape(account.name)}<br>${escape(account.email)}</p><form method="post" action="/connect/gbfm/account"><input type="hidden" name="oauth_query" value="${escape(query)}"><button class="quiet" type="submit">Use another account</button></form><small>Switching accounts signs you out of Goosebumps FM in this browser.</small></div>
<section aria-labelledby="permissions"><h2 id="permissions">This app will be able to</h2><ul>${scopes.map((scope) => `<li>${scope === 'posts:read' ? 'Read posts available to your account, including your own editorial drafts and private posts' : 'Keep access until you disconnect, even when you are not signed in'}</li>`).join('')}</ul>
<p>This connection cannot create, edit, publish or delete posts. Only connect apps you trust.</p>
<p class="destination">Returns to: <strong>${escape(destination)}</strong></p><small>${loopback ? 'This is a local callback to an app on this computer.' : 'This is the callback destination registered by the app.'} The app name is supplied by its developer, not verified by Goosebumps FM.</small></section>
<form class="actions" method="post" action="/connect/gbfm/consent"><input type="hidden" name="oauth_query" value="${escape(query)}"><button class="primary" name="decision" value="allow" type="submit">Allow connection</button><button name="decision" value="deny" type="submit">Cancel</button></form>
<p class="muted">After approval, you will return to ${escape(name)}. You can revoke access at any time in <a href="/dashboard/connections">Connections</a>.</p>`,
  )
}
