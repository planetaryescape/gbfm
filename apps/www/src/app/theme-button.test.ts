import { Component } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { it } from '@effect/vitest'
import { Effect } from 'effect'

import { PersistTheme, ReadTheme, ThemeControls, ThemeMessage } from './theme-button'

it.effect('keeps desktop and menu theme controls on the same persisted cycle', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(
      ThemeControls,
      {},
      {
        elements: Html.vocabulary,
        view: (themeControls, h) =>
          h.div.children(
            h.nav
              .attr('aria-label', 'Desktop')
              .children(themeControls.button(h.button).children(themeControls.label)),
            h.nav
              .attr('aria-label', 'Menu')
              .children(themeControls.button(h.button).children(themeControls.label)),
          ),
      },
    )

    const desktop = (name: string) =>
      Locator.inside(
        HtmlLocator.role('navigation', { name: 'Desktop' }),
        HtmlLocator.role('button', { name }),
      )

    const menu = (name: string) =>
      Locator.inside(
        HtmlLocator.role('navigation', { name: 'Menu' }),
        HtmlLocator.role('button', { name }),
      )

    s.resolve(ReadTheme, ThemeMessage.LoadedTheme({ theme: 'system' }))
      .click(desktop('Theme: system'))
      .resolve(PersistTheme.make({ theme: 'light' }), Component.noop)
      .expect(menu('Theme: light'))
      .toExist()
      .click(menu('Theme: light'))
      .resolve(PersistTheme.make({ theme: 'dark' }), Component.noop)
      .expect(desktop('Theme: dark'))
      .toExist()
      .click(desktop('Theme: dark'))
      .resolve(PersistTheme.make({ theme: 'system' }), Component.noop)
      .expect(menu('Theme: system'))
      .toExist()
  }),
)
