import { Locator, Scene, Story } from '@effect/ui/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { NavigationEvents, NavigationMessage } from './domain'
import { NavigationReady, TrackMenuDrag } from './gestures'
import { isActiveNavLink, nextScrollState, visibleNavigationLinks } from './links'
import { StationNavigation } from './station-navigation'

const props = {
  url: 'https://goosebumps.fm/about',
  principal: null,
  principalKnown: true,
}

describe('StationNavigation', () => {
  it.effect(
    'places theme controls in desktop navigation and the existing mobile account section',
    () =>
      Effect.gen(function* () {
        const scene = yield* Scene.make(StationNavigation, props)
        scene.expectMount(NavigationReady())
        scene.expectMount(TrackMenuDrag({ active: false }))
        const theme = Locator.attr('aria-label', 'Theme: system')
        assert.lengthOf(scene.all(theme), 2)
        assert.lengthOf(
          scene.all(
            Locator.inside(Locator.attr('class', 'flex shrink-0 items-center gap-3'), theme),
          ),
          1,
        )
        assert.lengthOf(
          scene.all(Locator.inside(Locator.attr('aria-label', 'Menu links'), theme)),
          1,
        )
      }),
  )

  it.effect('keeps menu actions inert before hydration', () =>
    Effect.gen(function* () {
      const story = yield* Story.make(StationNavigation, props)
      story.send(NavigationMessage.OpenedMenu({ method: 'keyboard' }))
      assert.isFalse(story.model.menuOpen)
      story.send(NavigationMessage.Ready())
      story.send(NavigationMessage.OpenedMenu({ method: 'keyboard' }))
      assert.isTrue(story.model.menuOpen)
      assert.strictEqual(story.model.menuOpenMethod, 'keyboard')
    }),
  )

  it.effect('owns settled pointer drag state and ignores other pointers', () =>
    Effect.gen(function* () {
      const story = yield* Story.make(StationNavigation, props)
      story.send(NavigationMessage.Ready())
      story.send(NavigationMessage.OpenedMenu({ method: 'touch' }))
      story.send(NavigationMessage.StartedMenuDrag({ pointerId: 3, clientY: 100 }))
      assert.isNull(story.model.menuDrag)
      story.send(NavigationMessage.SettledMenu({ open: true }))
      story.send(NavigationMessage.StartedMenuDrag({ pointerId: 3, clientY: 100 }))
      story.send(NavigationMessage.MovedMenuDrag({ pointerId: 4, clientY: 400 }))
      assert.strictEqual(story.model.menuOffset, 0)
      story.send(NavigationMessage.MovedMenuDrag({ pointerId: 3, clientY: 140 }))
      assert.strictEqual(story.model.menuOffset, 40)
      story.send(NavigationMessage.MovedMenuDrag({ pointerId: 3, clientY: 180 }))
      assert.strictEqual(story.model.menuOffset, 80)
      const moved = story.model

      story.send(NavigationMessage.MovedMenuDrag({ pointerId: 4, clientY: 400 }))
      assert.strictEqual(story.model, moved)
      story.send(
        NavigationMessage.ReleasedMenuDrag({
          pointerId: 3,
          clientY: 180,
          viewportHeight: 800,
        }),
      )
      assert.isTrue(story.model.menuOpen)
      assert.isNull(story.model.menuDrag)
      assert.strictEqual(story.model.menuOffset, 0)
      story.send(NavigationMessage.StartedMenuDrag({ pointerId: 3, clientY: 100 }))
      story.send(
        NavigationMessage.ReleasedMenuDrag({
          pointerId: 3,
          clientY: 260,
          viewportHeight: 800,
        }),
      )
      assert.isFalse(story.model.menuOpen)
    }),
  )

  it.effect('keeps the release offset for the closing menu animation', () =>
    Effect.gen(function* () {
      const story = yield* Story.make(StationNavigation, props)
      story.send(NavigationMessage.Ready())
      story.send(NavigationMessage.OpenedMenu({ method: 'touch' }))
      story.send(NavigationMessage.SettledMenu({ open: true }))
      story.send(NavigationMessage.StartedMenuDrag({ pointerId: 1, clientY: 100 }))
      story.send(
        NavigationMessage.ReleasedMenuDrag({
          pointerId: 1,
          clientY: 270,
          viewportHeight: 800,
        }),
      )
      assert.isFalse(story.model.menuOpen)
      assert.strictEqual(story.model.menuOffset, 170)
      assert.isNull(story.model.menuDrag)
    }),
  )

  it.effect('ignores a drag while the menu is closed', () =>
    Effect.gen(function* () {
      const story = yield* Story.make(StationNavigation, props)
      story.send(NavigationMessage.Ready())
      const closed = story.model

      story.send(NavigationMessage.StartedMenuDrag({ pointerId: 1, clientY: 100 }))
      assert.strictEqual(story.model, closed)
    }),
  )

  it.effect('emits search intent after closing its own overlays', () =>
    Effect.gen(function* () {
      const story = yield* Story.make(StationNavigation, props)
      story.send(NavigationMessage.Ready())
      story.send(NavigationMessage.OpenedMenu({ method: 'mouse' }))
      story.send(NavigationMessage.RequestedSearch()).emitted(NavigationEvents.RequestedSearch())
      assert.isFalse(story.model.menuOpen)
      assert.isFalse(story.model.accountOpen)
    }),
  )

  it.effect('resets transient navigation state when the location changes', () =>
    Effect.gen(function* () {
      const story = yield* Story.make(StationNavigation, props)
      story.send(NavigationMessage.Ready())
      story.send(NavigationMessage.ChangedMinimized({ minimized: true }))
      story.send(NavigationMessage.OpenedMenu({ method: 'mouse' }))
      story.send(
        NavigationMessage.ChangedLocation({
          url: 'https://goosebumps.fm/shows',
          principalId: null,
        }),
      )
      assert.isFalse(story.model.menuOpen)
      assert.isFalse(story.model.minimized)
      assert.strictEqual(story.model.url, 'https://goosebumps.fm/shows')
    }),
  )

  it.effect('renders collections only for admins through the native scene', () =>
    Effect.gen(function* () {
      const scene = yield* Scene.make(StationNavigation, props)
      scene.expectMount(NavigationReady())
      scene.expectMount(TrackMenuDrag({ active: false }))
      assert.strictEqual(scene.all(Locator.attr('href', '/collections')).length, 0)
      scene.props({
        ...props,
        principal: { id: 'admin', name: 'Admin', username: 'admin', image: null, role: 'admin' },
      })
      assert.isAbove(scene.all(Locator.attr('href', '/collections')).length, 0)
    }),
  )
})

describe('navigation link and scroll rules', () => {
  it('matches nested routes and keeps collections private to admins', () => {
    assert.isTrue(isActiveNavLink('/shows/example', '/shows'))
    assert.isTrue(isActiveNavLink('/tweet/example', '/tweets'))
    assert.isFalse(isActiveNavLink('/shows-extra', '/shows'))
    assert.isFalse(visibleNavigationLinks(null).some(([href]) => href === '/collections'))
  })

  it('uses the existing top zone and accumulated scroll travel', () => {
    assert.deepStrictEqual(nextScrollState({ y: 100, minimized: true }, 48), {
      y: 48,
      minimized: false,
    })
    assert.deepStrictEqual(nextScrollState({ y: 100, minimized: false }, 110), {
      y: 100,
      minimized: false,
    })
    assert.deepStrictEqual(nextScrollState({ y: 100, minimized: false }, 116), {
      y: 116,
      minimized: true,
    })
    assert.deepStrictEqual(nextScrollState({ y: 116, minimized: true }, 100), {
      y: 100,
      minimized: false,
    })
  })
})
