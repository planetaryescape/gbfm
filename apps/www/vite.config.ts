import { resolve } from 'node:path'
import { fileURLToPath, URL as NodeURL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

import { effectUi } from './plugins/effect-ui.ts'
import { repoChangelogPlugin } from './plugins/repo-changelog.ts'
import { sentryBuildPlugins } from './plugins/sentry.ts'

// VPS_PROXY_TARGET is deliberately not VITE_ prefixed: it steers the dev proxy
// only. Setting VITE_VPS_BASE_URL would also reach the browser bundle, making
// requests cross-site and dropping the session cookie.
const VPS_PROXY_TARGET =
  process.env.VPS_PROXY_TARGET || process.env.VITE_VPS_BASE_URL || 'http://127.0.0.1:3003'

const buildId =
  process.env.GBFM_BUILD_ID ?? process.env.APP_RELEASE ?? process.env.GITHUB_SHA ?? 'local'

const uploadSourceMaps = process.env.SENTRY_UPLOAD_SOURCEMAPS === 'true'

const sentryRelease =
  process.env.VITE_SENTRY_RELEASE ??
  (process.env.APP_RELEASE ? `gbfm-www@${process.env.APP_RELEASE}` : undefined)

const vpsProxy = {
  target: process.env.GBFM_FRONTEND_FIXTURE_BASE ?? VPS_PROXY_TARGET,
  changeOrigin: true,
}

export default defineConfig(({ command }) => ({
  define: {
    'import.meta.env.GBFM_BUILD_ID': JSON.stringify(buildId),
  },
  plugins: [
    effectUi({
      serverEntry: '/src/entry.effect.server.ts',
      clientEntry: '/src/entry.effect.client.ts',
      clientOutDir: 'dist/client',
      serverOutDir: 'dist/server',
      origin: process.env.GBFM_FRONTEND_ORIGIN,
    }),
    tailwindcss(),
    repoChangelogPlugin(),
    ...sentryBuildPlugins({
      upload: uploadSourceMaps,
      token: process.env.SENTRY_AUTH_TOKEN,
      release: sentryRelease,
    }),
  ],
  ssr: {
    target: 'webworker',
    noExternal: true,
    external: [
      'cloudflare:workers',
      'node:async_hooks',
      ...(command === 'serve' ? ['debug', 'extend'] : []),
    ],
  },
  environments:
    command === 'serve'
      ? {
          ssr: {
            keepProcessEnv: true,
            resolve: { builtins: ['node:async_hooks'] },
          },
        }
      : undefined,
  build: {
    sourcemap: uploadSourceMaps ? 'hidden' : false,
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
