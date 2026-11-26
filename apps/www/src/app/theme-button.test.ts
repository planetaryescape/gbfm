import { Story } from '@effect/ui/testing'
import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { PersistTheme, ReadTheme, ThemeButton, ThemeMessage } from './theme-button'

it.effect('loads the saved theme and persists the next selected theme', () =>
  Effect.gen(function* () {
    const story = yield* Story.make(ThemeButton, {})
    story.expectExact(ReadTheme)
    story.resolve(ReadTheme, ThemeMessage.LoadedTheme({ theme: 'dark' }))
    story.send(ThemeMessage.ClickedTheme()).expectExact(PersistTheme.make({ theme: 'system' }))

    expect(story.model.theme).toBe('system')
    story.resolve(PersistTheme, Component.noop)
  }),
)

it.effect('cycles system to light without borrowing state from its parent', () =>
  Effect.gen(function* () {
    const story = yield* Story.make(ThemeButton, {})
    story.resolve(ReadTheme, ThemeMessage.LoadedTheme({ theme: 'system' }))
    story.send(ThemeMessage.ClickedTheme()).expectExact(PersistTheme.make({ theme: 'light' }))

    expect(story.model.theme).toBe('light')
    story.resolve(PersistTheme, Component.noop)
  }),
)

import { Component } from '@effect/ui'
