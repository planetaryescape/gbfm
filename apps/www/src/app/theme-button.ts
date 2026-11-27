import { Command, Component, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Effect, Schema } from 'effect'

import { readTheme, saveTheme, Theme } from '../theme'

export const ThemeMessage = UiSchema.TaggedEnum({
  ClickedTheme: {},
  LoadedTheme: { theme: Theme },
})

export const ReadTheme = Command.make('ReadTheme', { args: {} }, () =>
  Effect.sync(() => ThemeMessage.LoadedTheme({ theme: readTheme() })),
)

export const PersistTheme = Command.make('PersistTheme', { args: { theme: Theme } }, ({ theme }) =>
  Effect.sync(() => saveTheme(theme)).pipe(Effect.as(Component.noop)),
)

const nextTheme = (theme: Theme): Theme => {
  if (theme === 'system') return 'light'

  if (theme === 'light') return 'dark'

  return 'system'
}

export const ThemeControls = Html.component({
  name: 'ThemeControls',
  model: Schema.Struct({ theme: Theme }),
  message: ThemeMessage,
}).make({
  init: ($) => $.set({ theme: 'system' }).run(ReadTheme.make({})),
  update: {
    LoadedTheme: ($, { theme }) => $.evolve({ theme }),
    ClickedTheme: ($) => {
      const theme = nextTheme($.model.theme)

      return $.evolve({ theme }).run(PersistTheme.make({ theme }))
    },
  },
  parts: (p, model) => ({
    label: `Theme: ${model.theme}`,
    button: p.part('button', (button) =>
      button
        .attr('type', 'button')
        .attr('aria-label', `Theme: ${model.theme}`)
        .on('click', ThemeMessage.ClickedTheme()),
    ),
  }),
})

export const ThemeButton = Html.component({
  name: 'ThemeButton',
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: {},
  view: (h) =>
    ThemeControls(h, {
      view: (themeControls) =>
        themeControls
          .button(h.button)
          .class('rounded-full border border-border px-3 py-2 text-sm hover:bg-accent')
          .children(themeControls.label),
    }),
})
