import { dark, light } from '@gbfm/theme'
import * as Server from 'foldkit/experimental/server'

import { serverTraceMeta } from '../observability/server'
import { fallbackArtwork } from '../view/artwork'

// Foldkit passes the same application object from Rendered to renderDocument.
// Weak keys keep concurrent requests isolated without retaining completed pages.
const pageHeads = new WeakMap<Server.RenderedApplication, string>()

/** Associates already-escaped, server-owned head markup with one rendered page. */
export const withDocumentHead = (application: Server.RenderedApplication, head: string) => {
  pageHeads.set(application, head)

  return application
}

const shellHead = String.raw`
${import.meta.env.DEV ? '<link rel="stylesheet" href="/src/styles/main.css">' : ''}
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
      const art = new URL(current.thumbnailUrl || '${fallbackArtwork}', location.origin)
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

/** Renders the shell and request head with the host's resolved browser assets. */
export const renderDocument: Server.DocumentRenderer = (application, assets) =>
  Server.renderDocument(application, assets, {
    head: shellHead + serverTraceMeta() + (pageHeads.get(application) ?? ''),
  }).replace(
    // Foldkit 0.167 has no viewport option. Replace its default, never add a duplicate.
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  )
