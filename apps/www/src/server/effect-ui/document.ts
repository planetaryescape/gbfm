import { HtmlServer } from '@effect/ui/html'
import { dark, light } from '@gbfm/theme'

import { fallbackArtwork } from '../../ui/artwork'
import type { DocumentAssets, RenderedPage } from './types'

const escapeAttribute = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const shellHead = String.raw`
<link rel="icon" type="image/png" href="/fav.png">
<link rel="preload" href="/fonts/JetBrainsMono-ExtraBold-latin.woff2" as="font" type="font/woff2" crossorigin>
<meta name="theme-color" content="${light.backgroundHex}">
<script>
  (() => {
    let saved = 'system'
    try { saved = localStorage.getItem('vite-ui-theme') || 'system' } catch {}
    const resolved = saved === 'light' || saved === 'dark'
      ? saved
      : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    document.documentElement.classList.add(resolved)
    document.documentElement.dataset.theme = resolved
    document.querySelector('meta[name="theme-color"]').setAttribute('content',
      resolved === 'dark' ? '${dark.backgroundHex}' : '${light.backgroundHex}')
  })()
  ;(() => {
    try {
      const queue = JSON.parse(localStorage.getItem('gbfm-audio-queue.json') || 'null')
      const current = queue && Array.isArray(queue.tracks) ? queue.tracks[queue.currentIndex] : null
      if (!current) return
      let art = new URL('${fallbackArtwork}', location.origin)
      try {
        const candidate = new URL(current.thumbnailUrl || '${fallbackArtwork}', location.origin)
        const path = decodeURIComponent(candidate.pathname).replace(/\\/g, '/')
        const publicPath = !/^\/(?:user-content|mixes)\/private(?:\/|$)/.test(path)
        if ((candidate.protocol === 'http:' || candidate.protocol === 'https:') && publicPath) {
          art = candidate
        }
      } catch {}
      if (art.hostname === 'cdn.goosebumps.fm') {
        art.searchParams.set('w', '96')
        art.searchParams.set('q', '80')
        art.searchParams.set('f', 'webp')
      }
      document.documentElement.dataset.queued = ''
      document.documentElement.style.setProperty('--queued-art', 'url("' + art.href + '")')
    } catch {}
  })()
</script>
<style>
  html[data-theme='dark'] { color-scheme: dark; background-color: ${dark.backgroundHex}; }
  html[data-theme='light'] { color-scheme: light; background-color: ${light.backgroundHex}; }
</style>`

export const renderDocument = (page: RenderedPage, assets: DocumentAssets): string => {
  const styles = assets.stylesheets
    .map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`)
    .join('')

  const preloads = assets.modulePreloads
    .map((href) => `<link rel="modulepreload" href="${escapeAttribute(href)}">`)
    .join('')

  return `<!doctype html>
<html ${page.htmlAttributes}>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${shellHead}${page.head}${page.extraHead}${styles}${preloads}</head>
<body ${page.bodyAttributes}>
<div id="root">${page.html}</div>
<script type="application/json" id="gbfm-ui-state">${HtmlServer.serializeState(page.state)}</script>
<script type="application/json" id="gbfm-ui-props">${page.serializedProps}</script>
<script type="module" src="${escapeAttribute(assets.entryScript)}"></script>
</body></html>`
}
