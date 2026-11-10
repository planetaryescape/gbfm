import { Match } from 'effect'

import { brandWordmark } from './brand'
import type { ClientBrand } from './client-brand'
import type { PendingContinuation } from './domain'
import { connectionPair, icons } from './icons'
import { connectionStyles } from './styles'

export const escape = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)

export const connectionDocument = (title: string, content: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin"><meta name="robots" content="noindex,nofollow"><title>${escape(title)} | Goosebumps FM</title>
<style>${connectionStyles}</style></head><body><main><header><a class="brand" href="/" aria-label="Goosebumps FM">${brandWordmark}</a><p class="eyebrow">App connection</p></header>${content}</main></body></html>`

export const appIdentity = (name: string, brand?: ClientBrand) =>
  connectionPair(escape(Array.from(name.trim())[0]?.toUpperCase() ?? '?'), brand)

export const connectionErrorDocument = (status: number, continuation?: PendingContinuation) => {
  const title = Match.value(status).pipe(
    Match.when(409, () => 'Requested permissions are unavailable'),
    Match.when(403, () => 'This account cannot connect'),
    Match.orElse(() => 'Connection not completed'),
  )

  const detail =
    status === 409
      ? 'This connection cannot receive all requested permissions. Ask the operator to check this environment’s policy and the app registration, then start a fresh authorization from your app. Signing in again alone cannot add permissions.'
      : status === 403
        ? 'Connections need a creator, editor or admin account.'
        : status >= 500
          ? 'Something went wrong. Try again from your app.'
          : 'This request expired. Start again from your app.'

  return connectionDocument(
    title,
    `<div class="status">${icons.alert}</div><h1>${title}</h1><p>${detail}</p>${status === 403 && continuation ? `<form method="post" action="/connect/gbfm/account"><input type="hidden" name="oauth_query" value="${escape(continuation.query)}"><button class="primary" type="submit">Use another account (signs you out)</button></form>` : ''}<p><a class="button" href="/">Back to Goosebumps FM</a></p>`,
  )
}

export const permissionsUnavailableDocument = (state: {
  readonly requested: ReadonlyArray<string>
  readonly available: ReadonlyArray<string>
  readonly blocked: ReadonlyArray<string>
}) =>
  connectionDocument(
    'Requested permissions are unavailable',
    `<div class="status">${icons.alert}</div><h1>Requested permissions are unavailable</h1><p>This GBFM environment has not enabled every permission your app requested. No permission upgrade has been approved.</p><h2>Requested</h2><p>${escape(state.requested.join(', '))}</p><h2>Available in this environment</h2><p>${escape(state.available.join(', ') || 'None')}</p><h2>Not enabled</h2><p>${escape(state.blocked.join(', '))}</p><p>An operator must enable these permissions before you reconnect. Signing in again or refreshing a token cannot enable them.</p><p><a class="button" href="/dashboard/connections">View your current connections</a></p>`,
  )
