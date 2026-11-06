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
      ? 'Connections need a creator, editor or admin account.'
      : status >= 500
        ? 'Something went wrong. Try again from your app.'
        : 'This request expired. Start again from your app.'

  return connectionDocument(
    title,
    `<h1>${title}</h1><p>${detail}</p>${status === 403 && continuation ? `<form method="post" action="/connect/gbfm/account"><input type="hidden" name="oauth_query" value="${escape(continuation.query)}"><button class="primary" type="submit">Use another account (signs you out)</button></form>` : ''}<p><a class="button" href="/">Back to Goosebumps FM</a></p>`,
  )
}
