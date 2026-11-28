import { Html } from '@effect/ui/html'
import { Locator, Scene } from '@effect/ui/testing'
import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { ContentTypeTabs, DashboardHeader } from './navigation-view'
import { sectionFromUrl } from './sections'

const HeaderFixture = Html.component({
  name: 'DashboardHeaderFixture',
  props: Schema.Struct({ section: Schema.String, role: Schema.NullOr(Schema.String) }),
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    h.div.children(
      DashboardHeader(h, h.props.section, h.props.role),
      h.props.section.startsWith('all/') ? ContentTypeTabs(h, h.props.section) : undefined,
    ),
})

describe('native grouped dashboard navigation', () => {
  it.each([
    { role: 'user', groups: ['Library', 'Settings'] },
    { role: 'creator', groups: ['Library', 'My content', 'Settings'] },
  ])(
    'renders only the $role personal groups and the original sign-out action',
    ({ role, groups }) =>
      Effect.runSync(
        Effect.scoped(
          Effect.gen(function* () {
            const s = yield* Scene.make(HeaderFixture, { role, section: 'favorites' })
            const groupTabs = Locator.attr('aria-label', 'Dashboard sections')
            expect(
              s.current
                .all(Locator.inside(groupTabs, Locator.tag('a')))
                .map((node) => Locator.textOf(node)),
            ).toEqual(groups)
            expect(
              s.current.query(Locator.attr('aria-label', 'Dashboard workspaces')),
            ).toBeUndefined()
            expect(s.current.query(Locator.attr('action', '/actions/sign-out'))).toBeDefined()
            expect(s.current.query(Locator.attr('href', '/dashboard/admin'))).toBeUndefined()
          }),
        ),
      ),
  )

  it('marks the Admin/Music/Catalog path for a nested entity route', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scene.make(HeaderFixture, {
            role: 'admin',
            section: 'music-entity/album/abc',
          })

          const current = Locator.attr('aria-current', 'page')
          expect(
            Locator.textOf(
              s.current.get(
                Locator.inside(Locator.attr('aria-label', 'Dashboard workspaces'), current),
              ),
            ),
          ).toBe('Admin')
          expect(
            Locator.textOf(
              s.current.get(
                Locator.inside(Locator.attr('aria-label', 'Dashboard sections'), current),
              ),
            ),
          ).toBe('Music')
          expect(
            Locator.textOf(
              s.current.get(Locator.inside(Locator.attr('aria-label', 'Music'), current)),
            ),
          ).toBe('Catalog')
          expect(
            s.current
              .all(
                Locator.inside(Locator.attr('aria-label', 'Dashboard sections'), Locator.tag('a')),
              )
              .map(Locator.textOf),
          ).toEqual(['Overview', 'Content', 'Music', 'People', 'Comms', 'System'])
        }),
      ),
    ))

  it('keeps callback aliases in Settings and content-type aliases in All content', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const callback = yield* Scene.make(HeaderFixture, {
            role: 'creator',
            section: 'spotify-callback',
          })

          expect(
            Locator.textOf(
              callback.current.get(
                Locator.inside(
                  Locator.attr('aria-label', 'Settings'),
                  Locator.attr('aria-current', 'page'),
                ),
              ),
            ),
          ).toBe('Integrations')
          const content = yield* Scene.make(HeaderFixture, { role: 'admin', section: 'all/tweets' })
          expect(
            Locator.textOf(
              content.current.get(
                Locator.inside(
                  Locator.attr('aria-label', 'Content'),
                  Locator.attr('aria-current', 'page'),
                ),
              ),
            ),
          ).toBe('All content')
          expect(
            Locator.textOf(
              content.current.get(
                Locator.inside(
                  Locator.attr('aria-label', 'Content types'),
                  Locator.attr('aria-current', 'page'),
                ),
              ),
            ),
          ).toBe('Tweets')
          expect(
            content.current.query(Locator.attr('href', '/dashboard/all/editorial')),
          ).toBeDefined()
        }),
      ),
    ))

  it('opens the Library favorites page at the original dashboard home URL', () => {
    expect(sectionFromUrl('/dashboard')).toBe('favorites')
    expect(sectionFromUrl('/spotify/callback')).toBe('spotify-callback')
  })
})
