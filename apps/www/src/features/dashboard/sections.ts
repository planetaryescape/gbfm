import { sectionHref as navigationHref, sectionLabel } from './navigation'

const labelled = (sections: ReadonlyArray<string>): ReadonlyArray<readonly [string, string]> =>
  sections.map((section) => [
    section,
    section === 'overview' ? 'Your dashboard' : sectionLabel(section, 'admin'),
  ])

export const dashboardSections = labelled([
  'overview',
  'favorites',
  'reminders',
  'content/mixes',
  'content/tweets',
  'content/editorial',
  'profile',
  'email',
  'player',
  'appearance',
  'integrations',
  'connections',
  'api-keys',
])

export const adminSections = labelled([
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
  'featured-mix',
  'all/mixes',
  'all/tweets',
  'all/editorial',
])

export const sectionFromUrl = (url: string) => {
  const pathname = new URL(url, 'http://localhost').pathname

  if (pathname === '/spotify/callback') return 'spotify-callback'

  return pathname.replace(/^\/dashboard\/?/, '') || 'favorites'
}

export const sectionHref = navigationHref

export const isAdminSection = (section: string) =>
  adminSections.some(([name]) => name === section) || section.startsWith('music-entity/')

export { sectionLabel } from './navigation'

export const entityRoute = (section: string) => {
  const match = /^music-entity\/(artist|album|track|label)\/([^/]+)$/.exec(section)

  if (!match || !match[1] || !match[2]) return null

  return {
    kind: match[1],
    id: match[2],
    path: `/api/music/${match[1]}s/${encodeURIComponent(match[2])}`,
  }
}

export const pageOffset = (query: URLSearchParams) => {
  const offset = Number(query.get('offset') ?? '0')

  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0
}

export const endpointFor = (section: string, query = new URLSearchParams()): string | null => {
  const entity = entityRoute(section)

  if (entity) return entity.path

  if (/^(content|all)\/(mixes|tweets|editorial)$/.test(section)) {
    const params = new URLSearchParams({ limit: '25', offset: String(pageOffset(query)) })

    if (section.endsWith('mixes')) return `/api/content/audio/mix/manage?${params}`
    params.set('type', section.endsWith('tweets') ? 'micro' : 'post')

    return `/api/content/posts/manage?${params}`
  }

  if (section === 'search')
    return query.get('q')?.trim()
      ? `/api/search?${new URLSearchParams({ q: query.get('q')?.trim() ?? '' })}`
      : null

  if (section === 'music') {
    const tab =
      ['artists', 'albums', 'tracks', 'playlists', 'labels'].find(
        (item) => item === query.get('tab'),
      ) ?? 'artists'

    return `/api/music/${tab}${tab === 'labels' ? '/manage' : ''}`
  }

  if (section === 'users') {
    const params = new URLSearchParams({ limit: '25', offset: String(pageOffset(query)) })

    if (query.get('search')?.trim()) {
      params.set('searchField', 'email')
      params.set('searchValue', query.get('search')?.trim() ?? '')
    }

    return `/auth/admin/list-users?${params}`
  }

  if (section === 'email-logs') {
    const params = new URLSearchParams({ limit: '25', offset: String(pageOffset(query)) })

    for (const key of ['status', 'recipientEmail', 'dateFrom', 'dateTo']) {
      const value = query.get(key)?.trim()

      if (value) params.set(key, value)
    }

    return `/api/email/logs?${params}`
  }

  const endpoints = new Map(
    Object.entries({
      overview: '/api/favorites?limit=25&offset=0',
      favorites: '/api/favorites?limit=25&offset=0',
      reminders: '/api/music-reminders',
      admin: '/api/admin/overview',
      'featured-mix': '/api/admin/featured-mix',
      profile: '/api/user/profile',
      connections: '/api/user/mcp-connections',
      email: '/api/user/email-preferences',
      shows: '/api/shows/manage?limit=25&offset=0',
      playlists: '/api/music/playlists',
      newsletter: '/api/admin/newsletter-subscribers',
      emails: '/api/email/mix-announcement-options',
      'frontend-errors': '/api/admin/telemetry',
    }),
  )

  return endpoints.get(section) ?? null
}
