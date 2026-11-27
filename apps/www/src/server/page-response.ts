import { renderDocumentHead } from '@gbfm/site-metadata'
import { Effect } from 'effect'
import * as Server from 'foldkit/experimental/server'

import { applicationConfig } from '../config'
import { withDocumentHead } from './document'
import type { LoadedPage } from './http-dispatch'
import { preparePageResponse } from './prepare-page-response'

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

export const createPageResponse = async (
  ownedRequest: Request,
  dataRequest: boolean,
  startedAt: number,
  page: LoadedPage,
): Promise<Server.EntryResult> => {
  const { document, status, headers, extraHead } = await preparePageResponse(
    ownedRequest,
    startedAt,
    page,
  )

  if (dataRequest) return Server.Responded(Response.json(document, { status, headers }))
  const renderOptions = { flags: document, url: page.url.href }

  const rendered = await Effect.runPromise(
    Server.renderToString(
      applicationConfig,
      import.meta.env.DEV
        ? { ...renderOptions, buildId: import.meta.env.FOLDKIT_BUILD_ID }
        : renderOptions,
    ),
  )

  const head = renderDocumentHead(document.metadata)

  const metadataHead = head.meta
    .flatMap((entry) =>
      'title' in entry || ('property' in entry && entry.property === 'og:url')
        ? []
        : [
            `<meta data-gbfm-metadata ${'name' in entry ? `name="${escapeHtml(entry.name)}"` : `property="${escapeHtml(entry.property)}"`} content="${escapeHtml(entry.content)}">`,
          ],
    )
    .join('')

  const scripts = head.scripts
    .map(
      (script) =>
        `<script data-gbfm-metadata type="application/ld+json">${script.children.replaceAll('<', '\\u003c')}</script>`,
    )
    .join('')

  return Server.Rendered(withDocumentHead(rendered, metadataHead + scripts + extraHead), {
    status,
    headers,
  })
}
