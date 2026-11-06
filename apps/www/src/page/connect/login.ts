import { connectionDocument, escape } from './document'
import type { PendingContinuation } from './domain'

export const connectionLoginDocument = ({
  continuation,
  clientName,
  email = '',
  error,
}: {
  readonly continuation: PendingContinuation
  readonly clientName: string
  readonly email?: string
  readonly error?: string
}) =>
  connectionDocument(
    `Sign in to connect ${clientName}`,
    `<h1>Connect ${escape(clientName)}</h1>
<p>Sign in to Goosebumps FM to continue. You will review the requested access before approving this connection.</p>
<p class="muted">An existing creator, editor or admin account is required.</p>
${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}
<form method="post" action="/connect/gbfm/sign-in">
<input type="hidden" name="oauth_query" value="${escape(continuation.query)}">
<label for="email">Email</label><input id="email" type="email" name="email" autocomplete="username" required value="${escape(email)}">
<label for="password">Password</label><input id="password" type="password" name="password" autocomplete="current-password" required>
<div class="actions"><button class="primary" type="submit">Sign in and continue</button></div></form>
<form method="post" action="/connect/gbfm/cancel"><input type="hidden" name="oauth_query" value="${escape(continuation.query)}"><button type="submit">Cancel connection</button></form>
<div class="divider"><a href="/auth/forgot-password">Forgot your password?</a><small>After resetting your password, return to your app and start a new connection. Signing in does not grant access on its own.</small></div>`,
  )
