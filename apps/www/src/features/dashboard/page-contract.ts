const documentlessSections = new Set([
  'api-keys',
  'appearance',
  'player',
  'integrations',
  'spotify-callback',
  'sessions',
])

export const isDocumentlessDashboardSection = (section: string, query: URLSearchParams) =>
  documentlessSections.has(section) || (section === 'search' && !query.get('q')?.trim())
