import { EditorialOAuthSettings } from '@gbfm/core/editorial-mcp'
import { Layer, Schema } from 'effect'
import { HttpRouter } from 'effect/http'
import { expect, test } from 'vitest'

import { ConfigService, createConfig } from '@/services/config.service'

import { McpGuideRoutesLive } from './mcp-guide.routes'

test.each([
  ['https://api.goosebumps.fm', 'https://goosebumps.fm'],
  ['https://preview-api.example.workers.dev', 'https://preview.example.workers.dev'],
  ['https://gbfm.localhost', 'https://gbfm.localhost'],
])('public guide advertises configured MCP and frontend URLs for %s', async (api, frontend) => {
  const defaults = createConfig()

  const handler = HttpRouter.toWebHandler(
    McpGuideRoutesLive.pipe(
      Layer.provide(
        Layer.succeed(ConfigService, {
          ...defaults,
          urls: { ...defaults.urls, frontend },
          mcp: Schema.decodeUnknownSync(EditorialOAuthSettings)({
            resourceUrl: `${api}/mcp`,
            issuer: `${api}/auth`,
          }),
        }),
      ),
    ),
    { disableLogger: true },
  )

  try {
    const response = await handler.handler(
      new Request('https://untrusted.example/mcp.txt', {
        headers: { 'x-forwarded-host': 'untrusted.example' },
      }),
    )

    const text = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(text).toContain(`Server URL: ${api}/mcp`)
    expect(text).toContain(`${frontend}/dashboard/connections`)
    expect(text).not.toContain('untrusted.example')
    expect(text).toContain('posts:read')
    expect(text).toContain('list_drafts')
    expect(text).toContain('get_post')
    expect(text).toContain('create_draft')
    expect(text).toContain('update_draft')
    expect(text).toContain('drafts:write')
    expect(text).toContain('list_published_posts')
    expect(text).toContain('get_show')
    expect(text).toContain('list_show_episodes')

    for (const name of [
      'search_catalogue',
      'get_mix',
      'get_public_profile',
      'get_public_collection',
    ]) {
      expect(text).toContain(`- ${name}:`)
    }

    expect(text).toContain('tools and read_micro_thread are not registered')
    expect(text).toContain('Production allowedScopes is unchanged')
    expect(text).toContain('Existing connections remain read-only')
    expect(text).toContain(
      'never publish, delete, change creators, change media or edit published posts',
    )
    expect(text).toContain('/mcps')
    expect(text).toContain('personal API keys cannot replace MCP OAuth credentials')

    const example = text.split('```json\n')[1]?.split('\n```')[0]

    expect(example).toBeDefined()
    expect(JSON.parse(example ?? '')).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        servers: {
          gbfm: {
            type: 'remote',
            url: `${api}/mcp`,
            protocol: '2026-07-28',
            disabled: true,
          },
        },
      },
    })

    const head = await handler.handler(new Request(`${api}/mcp.txt`, { method: 'HEAD' }))

    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toContain('text/plain')
    expect(await head.text()).toBe('')
  } finally {
    await handler.dispose()
  }
})

test('disabled and invalid MCP configurations return public, non-sensitive unavailable text', async () => {
  for (const shareUrl of ['http://localhost:3003', 'https://user:private@invalid.test']) {
    const handler = HttpRouter.toWebHandler(
      McpGuideRoutesLive.pipe(
        Layer.provide(
          Layer.succeed(
            ConfigService,
            createConfig({
              APP_STAGE: 'test',
              SHARE_URL: shareUrl,
              USER_CONTENT_BUCKET_NAME: 'disposable',
              MIXES_BUCKET_NAME: 'disposable',
              BETTER_AUTH_SECRET: undefined,
              BETTER_AUTH_URL: undefined,
              CloudflareAnalyticsApiToken: undefined,
              SENTRY_BACKEND_DSN: undefined,
              SpotifyClientId: undefined,
              SpotifyClientSecret: undefined,
              StorageRegion: undefined,
              VITE_PUBLIC_SENTRY_DSN: undefined,
            }),
          ),
        ),
      ),
      { disableLogger: true },
    )

    try {
      const response = await handler.handler(new Request('https://website.example/mcp.txt'))

      expect(response.status).toBe(503)
      expect(response.headers.get('content-type')).toContain('text/plain')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.text()).toBe(
        'GBFM editorial MCP is unavailable in this environment. No connection URL is advertised.\n',
      )
    } finally {
      await handler.dispose()
    }
  }
})
