import type { ClientBrand } from './client-brand'
import { appIdentity, connectionDocument, escape } from './document'
import type { PendingContinuation } from './domain'

export const connectionLoginDocument = ({
  continuation,
  clientName,
  clientBrand,
  email = '',
  error,
}: {
  readonly continuation: PendingContinuation
  readonly clientName: string
  readonly clientBrand?: ClientBrand
  readonly email?: string
  readonly error?: string
}) =>
  connectionDocument(
    `Sign in to connect ${clientName}`,
    `${appIdentity(clientName, clientBrand)}<h1>Connect ${escape(clientName)}</h1>
<p class="muted">Sign in with a creator, editor or admin account. You will review access next.</p>
${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}
<form method="post" action="/connect/gbfm/sign-in">
<input type="hidden" name="oauth_query" value="${escape(continuation.query)}">
<label for="email">Email</label><input id="email" type="email" name="email" autocomplete="username" required value="${escape(email)}">
<label for="password">Password</label><input id="password" type="password" name="password" autocomplete="current-password" required>
<div class="actions"><button class="primary" type="submit">Sign in and continue</button></div></form>
<div class="links"><form method="post" action="/connect/gbfm/cancel"><input type="hidden" name="oauth_query" value="${escape(continuation.query)}"><button class="quiet" type="submit">Cancel connection</button></form><a href="/auth/forgot-password" title="After resetting, start the connection again from your app">Forgot password?</a></div>`,
  )
