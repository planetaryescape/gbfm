import { entityRoute, tabs } from './page/catalog'

const adminSections = new Set([
  'admin',
  'users',
  'sessions',
  'shows',
  'music',
  'playlists',
  'search',
  'newsletter',
  'emails',
  'email-logs',
  'frontend-errors',
  'all/mixes',
  'featured-mix',
  'all/tweets',
  'all/editorial',
])

export const isAdminSection = (section: string) =>
  adminSections.has(section) || section.startsWith('music-entity/')

export const pageOffset = (query: URLSearchParams) => {
  const offset = Number(query.get('offset') ?? '0')

  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0
}

const pagedEndpoints = new Map(
  Object.entries({
    'content/mixes': ['/api/content/audio/mix/manage', {}],
    'content/tweets': ['/api/content/posts/manage', { type: 'micro' }],
    'content/editorial': ['/api/content/posts/manage', { type: 'post' }],
    'all/mixes': ['/api/content/audio/mix/manage', {}],
    'all/tweets': ['/api/content/posts/manage', { type: 'micro' }],
    'all/editorial': ['/api/content/posts/manage', { type: 'post' }],
  } satisfies Record<string, readonly [string, Record<string, string>]>),
)

export const pageSize = 25

export const endpointFor = (section: string, query = new URLSearchParams()) => {
  const entity = entityRoute(section)

  if (entity) return entity.path

  const paged = pagedEndpoints.get(section)

  if (paged) {
    const [path, filters] = paged

    return `${path}?${new URLSearchParams({ ...filters, limit: String(pageSize), offset: String(pageOffset(query)) })}`
  }

  if (section === 'search') {
    const q = query.get('q')?.trim()

    return q ? `/api/search?${new URLSearchParams({ q })}` : null
  }

  if (section === 'email-logs') {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(pageOffset(query)),
    })

    for (const key of ['status', 'recipientEmail', 'dateFrom', 'dateTo']) {
      const value = query.get(key)?.trim()

      if (value) params.set(key, value)
    }

    return `/api/email/logs?${params}`
  }

  if (section === 'music') {
    const tab = tabs.find((tab) => tab === query.get('tab')) ?? 'artists'

    return `/api/music/${tab}${tab === 'labels' ? '/manage' : ''}`
  }

  if (section === 'users') {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(pageOffset(query)),
    })

    const search = query.get('search')?.trim()

    if (search) {
      params.set('searchField', 'email')
      params.set('searchValue', search)
    }

    return `/auth/admin/list-users?${params}`
  }

  const endpoints = new Map(
    Object.entries({
      overview: '/api/favorites?limit=25&offset=0',
      admin: '/api/admin/overview',
      'featured-mix': '/api/admin/featured-mix',
      profile: '/api/user/profile',
      connections: '/api/user/mcp-connections',
      email: '/api/user/email-preferences',
      favorites: '/api/favorites?limit=25&offset=0',
      reminders: '/api/music-reminders',
      shows: '/api/shows/manage?limit=25&offset=0',
      music: '/api/music/artists',
      playlists: '/api/music/playlists',
      newsletter: '/api/admin/newsletter-subscribers',
      emails: '/api/email/mix-announcement-options',
      'frontend-errors': '/api/admin/telemetry',
    }),
  )

  return endpoints.get(section) ?? null
}
