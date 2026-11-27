import { resolve } from 'node:path'
import { fileURLToPath, URL as NodeURL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

import { effectUi } from './plugins/effect-ui.ts'
import { repoChangelogPlugin } from './plugins/repo-changelog.ts'
import { sentryBuildPlugins } from './plugins/sentry.ts'

const proxyTarget =
  process.env.GBFM_FRONTEND_FIXTURE_BASE ??
  process.env.VPS_PROXY_TARGET ??
  process.env.VITE_VPS_BASE_URL ??
  'http://127.0.0.1:3003'

const proxy = { target: proxyTarget, changeOrigin: true }

const buildId =
  process.env.GBFM_BUILD_ID ?? process.env.APP_RELEASE ?? process.env.GITHUB_SHA ?? 'local'

export default defineConfig({
  define: {
    'import.meta.env.GBFM_BUILD_ID': JSON.stringify(buildId),
  },
  plugins: [
    effectUi({
      serverEntry: '/src/entry.effect.server.ts',
      clientEntry: '/src/entry.effect.client.ts',
      clientOutDir: 'dist-effect/client',
      serverOutDir: 'dist-effect/server',
      origin: process.env.GBFM_FRONTEND_ORIGIN,
    }),
    tailwindcss(),
    repoChangelogPlugin(),
    ...sentryBuildPlugins({
      upload: false,
      token: process.env.SENTRY_AUTH_TOKEN,
      release: process.env.VITE_SENTRY_RELEASE,
    }),
  ],
  ssr: {
    target: 'webworker',
    noExternal: true,
    external: ['cloudflare:workers', 'node:async_hooks'],
  },
  build: {
    sourcemap: false,
    rolldownOptions: { external: ['cloudflare:workers', /^node:/] },
  },
  resolve: {
    alias: {
      '@': resolve(fileURLToPath(new NodeURL('.', import.meta.url)), 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/mcp': proxy,
      '/.well-known/oauth-protected-resource': proxy,
      '/.well-known/oauth-authorization-server': proxy,
      '/api': proxy,
      '/health': proxy,
      '/rss.xml': proxy,
      '/sitemap.xml': proxy,
      '/s/': proxy,
    },
  },
})
