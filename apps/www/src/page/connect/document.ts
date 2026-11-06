import type { PendingContinuation } from './domain'
import { connectionStyles } from './styles'

export const escape = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)

export const connectionDocument = (title: string, content: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin"><meta name="robots" content="noindex,nofollow"><title>${escape(title)} | Goosebumps FM</title>
<style>${connectionStyles}</style></head><body><main><header><a class="brand" href="/">Goosebumps FM</a><p class="eyebrow">App connection</p></header>${content}</main></body></html>`

export const connectionErrorDocument = (status: number, continuation?: PendingContinuation) => {
  const title = status === 403 ? 'This account cannot connect' : 'Connection not completed'

  const detail =
    status === 403
      ? 'Editorial connections require a creator, editor or admin account. Return to your app and start again with an eligible account.'
      : status >= 500
        ? 'Goosebumps FM could not complete the connection right now. Try again from your app in a moment.'
        : 'This connection request has expired or is no longer valid. Return to your app and start a new connection.'

  return connectionDocument(
    title,
    `<h1>${title}</h1><p>${detail}</p>${status === 403 && continuation ? `<form method="post" action="/connect/gbfm/account"><input type="hidden" name="oauth_query" value="${escape(continuation.query)}"><button class="primary" type="submit">Use another account</button><small>This signs you out of Goosebumps FM in this browser.</small></form>` : ''}<p><a class="button" href="/">Back to Goosebumps FM</a></p>`,
  )
}
