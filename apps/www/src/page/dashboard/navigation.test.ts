import { describe, expect, it } from 'vitest'

import { resolveSection, sectionLabel, visibleWorkspaces } from './navigation'

const located = (section: string, role: Parameters<typeof resolveSection>[1] = 'admin') => {
  const resolved = resolveSection(section, role)

  return resolved
    ? [resolved.workspace.label, resolved.group.label, resolved.page.label].join(' / ')
    : null
}

describe('dashboard navigation', () => {
  it('places every personal section in the You workspace', () => {
    expect(located('favorites')).toBe('You / Library / Favorites')
    expect(located('reminders')).toBe('You / Library / Reminders')
    expect(located('content/mixes')).toBe('You / My content / Mixes')
    expect(located('content/tweets')).toBe('You / My content / Tweets')
    expect(located('content/editorial')).toBe('You / My content / Editorial')
    expect(located('profile')).toBe('You / Settings / Profile')
    expect(located('appearance')).toBe('You / Settings / Appearance')
    expect(located('email')).toBe('You / Settings / Email')
    expect(located('player')).toBe('You / Settings / Player')
    expect(located('integrations')).toBe('You / Settings / Integrations')
    expect(located('api-keys', 'user')).toBe('You / Settings / API keys')
  })

  it('places every admin section in the Admin workspace', () => {
    expect(located('admin')).toBe('Admin / Overview / Overview')
    expect(located('all/mixes')).toBe('Admin / Content / All content')
    expect(located('shows')).toBe('Admin / Content / Shows')
    expect(located('featured-mix')).toBe('Admin / Content / Featured mix')
    expect(located('music')).toBe('Admin / Music / Catalog')
    expect(located('playlists')).toBe('Admin / Music / Playlists')
    expect(located('users')).toBe('Admin / People / Users')
    expect(located('sessions')).toBe('Admin / People / Sessions')
    expect(located('emails')).toBe('Admin / Comms / Write email')
    expect(located('newsletter')).toBe('Admin / Comms / Subscribers')
    expect(located('email-logs')).toBe('Admin / Comms / Delivery history')
    expect(located('frontend-errors')).toBe('Admin / System / Telemetry')
    expect(located('search')).toBe('Admin / System / Search')
  })

  it('maps nested routes onto the page that owns them', () => {
    expect(located('all/tweets')).toBe('Admin / Content / All content')
    expect(located('all/editorial')).toBe('Admin / Content / All content')
    expect(located('music-entity/album/abc')).toBe('Admin / Music / Catalog')
    expect(located('spotify-callback')).toBe('You / Settings / Integrations')
  })

  it('hides sections the role cannot reach', () => {
    expect(located('users', 'user')).toBe(null)
    expect(located('music-entity/artist/abc', 'editor')).toBe(null)
    expect(located('content/mixes', 'user')).toBe(null)
    expect(located('content/mixes', 'creator')).toBe('You / My content / Mixes')
    expect(located('profile', null)).toBe('You / Settings / Profile')
    expect(located('unknown')).toBe(null)
  })

  it('offers the Admin workspace and creator group only to the right roles', () => {
    const labels = (role: Parameters<typeof visibleWorkspaces>[0]) =>
      visibleWorkspaces(role).map(
        (workspace) =>
          `${workspace.label}: ${workspace.groups.map((group) => group.label).join(', ')}`,
      )

    expect(labels('user')).toEqual(['You: Library, Settings'])
    expect(labels('creator')).toEqual(['You: Library, My content, Settings'])
    expect(labels('admin')).toEqual([
      'You: Library, My content, Settings',
      'Admin: Overview, Content, Music, People, Comms, System',
    ])
  })

  it('labels pages from the model and falls back to the section name', () => {
    expect(sectionLabel('email-logs', 'admin')).toBe('Delivery history')
    expect(sectionLabel('featured-mix', 'user')).toBe('featured mix')
  })
})
