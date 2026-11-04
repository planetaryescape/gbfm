import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { foldkit, foldkitSsr, foldkitViewIdentity } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

import { repoChangelogPlugin } from './plugins/repo-changelog.ts'
import { sentryBuildPlugins } from './plugins/sentry.ts'

// VPS_PROXY_TARGET is deliberately not VITE_ prefixed: it steers the dev proxy
// only. Setting VITE_VPS_BASE_URL would also reach the browser bundle, making
// requests cross-site and dropping the session cookie.
const VPS_PROXY_TARGET =
  process.env.VPS_PROXY_TARGET || process.env.VITE_VPS_BASE_URL || 'http://127.0.0.1:3003'

// Let Foldkit coordinate generated production IDs across Vite environments.
const buildId = process.env.FOLDKIT_BUILD_ID ?? process.env.APP_RELEASE

const uploadSourceMaps = process.env.SENTRY_UPLOAD_SOURCEMAPS === 'true'

const sentryRelease =
  process.env.VITE_SENTRY_RELEASE ??
  (process.env.APP_RELEASE ? `gbfm-www@${process.env.APP_RELEASE}` : undefined)

const vpsProxy = {
  target: VPS_PROXY_TARGET,
  changeOrigin: true,
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    // Aggregate development reloads preserve one server-cached model across clients.
    // Authenticated SSR must always initialize from the current request's flags.
    ...(command === 'serve'
      ? [
          foldkitViewIdentity(),
          foldkitSsr({
            serverEntry: '/src/entry.server.ts',
            clientEntry: '/src/entry.client.ts',
            buildId,
          }),
        ]
      : foldkit({
          buildId,
          ssr: {
            serverEntry: '/src/entry.server.ts',
            clientEntry: '/src/entry.client.ts',
            build: { clientOutDir: 'dist/client', serverOutDir: 'dist/server' },
          },
        })),
    tailwindcss(),
    repoChangelogPlugin(),
    ...sentryBuildPlugins({
      upload: uploadSourceMaps,
      token: process.env.SENTRY_AUTH_TOKEN,
      release: sentryRelease,
    }),
  ],
  ssr: { external: ['cloudflare:workers'] },
  build: {
    sourcemap: uploadSourceMaps ? 'hidden' : false,
    rolldownOptions: { external: ['cloudflare:workers'] },
  },
  resolve: {
    alias: {
      '@': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/mcp': vpsProxy,
      '/.well-known/oauth-protected-resource': vpsProxy,
      '/.well-known/oauth-authorization-server': vpsProxy,
      '/api': vpsProxy,
      '/health': vpsProxy,
      '/rss.xml': vpsProxy,
      '/sitemap.xml': vpsProxy,
      '/s/': vpsProxy,
    },
  },
}))
